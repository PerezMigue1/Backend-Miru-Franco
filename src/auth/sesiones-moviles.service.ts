import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ZONA_NEGOCIO } from '../common/utils/zona-mexico';
import { JWT_TTL_MOVIL_SEGUNDOS } from './jwt-ttl';
import { ContadorPorVentana, RENOVACIONES_POR_SESION, TOKENS_INEXISTENTES_POR_IP } from './limite-renovacion';
import {
  CANAL_MOVIL,
  DIAS_CONSERVAR_SESION,
  GRACIA_REUSO_MS,
  generarRefreshToken,
  hashRefreshToken,
  limpiarDispositivo,
  vencimientoSesion,
} from './sesion-movil';

const DIA_MS = 24 * 60 * 60_000;

const sesionVencida = () =>
  new UnauthorizedException({ message: 'Tu sesión venció. Inicia sesión de nuevo.', code: 'SESION_VENCIDA' });
const sesionRevocada = () =>
  new UnauthorizedException({ message: 'Tu sesión se cerró. Inicia sesión de nuevo.', code: 'SESION_REVOCADA' });
const renovacionEnCurso = () =>
  new ConflictException({
    message: 'Tu sesión se está renovando. Intenta de nuevo en unos segundos.',
    code: 'RENOVACION_EN_CURSO',
  });

/** Sesiones de la app móvil (ver sesion-movil.ts). Logs sin tokens ni datos personales: solo ids. */
@Injectable()
export class SesionesMovilesService {
  private readonly logger = new Logger(SesionesMovilesService.name);
  private limpiando = false;
  private readonly inexistentesPorIp = new ContadorPorVentana(TOKENS_INEXISTENTES_POR_IP);
  private readonly porSesion = new ContadorPorVentana(RENOVACIONES_POR_SESION);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /** `sid` = fila de la sesión; `fam` = su familia (JwtStrategy rechaza el token si la familia ya no tiene fila viva). */
  private firmarAcceso(usuario: { id: string; email: string }, sid: string, fam: string): string {
    const ahora = Math.floor(Date.now() / 1000);
    return this.jwtService.sign(
      { id: usuario.id, email: usuario.email, jti: crypto.randomBytes(16).toString('hex'), iat: ahora, canal: CANAL_MOVIL, sid, fam },
      { expiresIn: JWT_TTL_MOVIL_SEGUNDOS },
    );
  }

  private cuentaRevocada(
    usuario: { activo: boolean; confirmado: boolean; rol: string; tokensRevocadosDesde: Date | null } | null,
    sesionCreadaEn: Date,
  ): boolean {
    return (
      !usuario ||
      !usuario.activo ||
      !usuario.confirmado ||
      usuario.rol !== 'cliente' ||
      // logoutAll, logout, cambio o recuperación de contraseña posteriores a la sesión.
      (!!usuario.tokensRevocadosDesde && sesionCreadaEn.getTime() < usuario.tokensRevocadosDesde.getTime())
    );
  }

  private leerCuenta(usuarioId: string) {
    return this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, email: true, rol: true, activo: true, confirmado: true, tokensRevocadosDesde: true },
    });
  }

  /** Login o canje de Google con canal movil (la elegibilidad la decide AuthService). */
  async emitir(usuario: { id: string; email: string }, dispositivo?: unknown) {
    const refreshToken = generarRefreshToken();
    const ahora = new Date();
    const familiaId = crypto.randomUUID();
    const sesion = await this.prisma.sesionMovil.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashRefreshToken(refreshToken),
        familiaId,
        creadaEn: ahora,
        ultimoUso: ahora,
        expiraEn: vencimientoSesion(ahora),
        dispositivo: limpiarDispositivo(dispositivo),
      },
    });
    return {
      token: this.firmarAcceso(usuario, sesion.id, familiaId),
      refreshToken,
      refreshExpiraEn: sesion.expiraEn.toISOString(),
    };
  }

  /** POST /auth/movil/renovar: rota el token de renovación y entrega un token de acceso nuevo. */
  async renovar(refreshToken: string, ip?: string) {
    const ahora = new Date();
    const sesion = await this.prisma.sesionMovil.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
    if (!sesion) {
      // Solo los tokens que no existen cuentan para el tope por IP: con la IP del proxy compartida,
      // la basura de un tercero no puede bloquear las renovaciones válidas de las clientas.
      this.inexistentesPorIp.contar(`ip:${ip ?? 'desconocida'}`);
      throw sesionVencida();
    }
    // Límite por sesión (familia): solo tokens que existen, así la basura no crea claves.
    this.porSesion.contar(`familia:${sesion.familiaId}`);

    if (sesion.reemplazadaPorId) {
      // Token ya rotado. Recién rotado y con la familia viva: dos renovaciones de la misma app a la vez.
      const rotadaHaceMs = ahora.getTime() - (sesion.revocadaEn?.getTime() ?? 0);
      if (rotadaHaceMs < GRACIA_REUSO_MS) {
        const viva = await this.prisma.sesionMovil.findFirst({ where: { familiaId: sesion.familiaId, revocadaEn: null } });
        if (viva) {
          throw renovacionEnCurso();
        }
      }
      // Si no, alguien más tiene un token viejo: se cierra la familia completa.
      await this.revocarFamilia(sesion.familiaId, ahora);
      this.logger.warn(`Reuso de un token de renovación: sesión móvil cerrada (usuario ${sesion.usuarioId})`);
      throw sesionRevocada();
    }
    if (sesion.revocadaEn) {
      throw sesionRevocada();
    }
    if (sesion.expiraEn.getTime() <= ahora.getTime()) {
      throw sesionVencida();
    }

    const usuario = await this.leerCuenta(sesion.usuarioId);
    if (!usuario || this.cuentaRevocada(usuario, sesion.creadaEn)) {
      await this.revocarFamilia(sesion.familiaId, ahora);
      throw sesionRevocada();
    }

    const nuevoToken = generarRefreshToken();
    const nuevaId = crypto.randomUUID();
    const expiraEn = vencimientoSesion(ahora);
    await this.prisma.$transaction(async (tx) => {
      // Reclamo condicional: si otra petición ya rotó esta fila, no se crea una segunda sucesora.
      const reclamo = await tx.sesionMovil.updateMany({
        where: { id: sesion.id, revocadaEn: null, reemplazadaPorId: null },
        data: { revocadaEn: ahora, reemplazadaPorId: nuevaId, ultimoUso: ahora },
      });
      if (reclamo.count === 0) {
        throw renovacionEnCurso();
      }
      await tx.sesionMovil.create({
        data: {
          id: nuevaId,
          usuarioId: sesion.usuarioId,
          tokenHash: hashRefreshToken(nuevoToken),
          familiaId: sesion.familiaId,
          creadaEn: ahora,
          ultimoUso: ahora,
          expiraEn,
          dispositivo: sesion.dispositivo,
        },
      });
    });

    // Carrera con una revocación (logoutAll, cambio o recuperación de contraseña) que se confirmó entre la
    // lectura de la cuenta y la rotación: su updateMany pudo no ver la fila nueva. Se relee y, si la
    // cuenta se revocó después de crear la sesión anterior, se cierra la familia antes de firmar.
    const cuentaActual = await this.leerCuenta(sesion.usuarioId);
    if (!cuentaActual || this.cuentaRevocada(cuentaActual, sesion.creadaEn)) {
      await this.revocarFamilia(sesion.familiaId);
      throw sesionRevocada();
    }

    return {
      success: true,
      token: this.firmarAcceso(usuario, nuevaId, sesion.familiaId),
      refreshToken: nuevoToken,
      refreshExpiraEn: expiraEn.toISOString(),
    };
  }

  private async revocarFamilia(familiaId: string, ahora = new Date()) {
    await this.prisma.sesionMovil.updateMany({ where: { familiaId, revocadaEn: null }, data: { revocadaEn: ahora } });
  }

  /** Logout con refreshToken: cierra esa sesión (su familia), solo si es de la misma cuenta. */
  async revocarPorToken(refreshToken: string, usuarioId: string) {
    const sesion = await this.prisma.sesionMovil.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
    if (!sesion || sesion.usuarioId !== usuarioId) return;
    await this.revocarFamilia(sesion.familiaId);
  }

  async revocarTodas(usuarioId: string) {
    await this.prisma.sesionMovil.updateMany({ where: { usuarioId, revocadaEn: null }, data: { revocadaEn: new Date() } });
  }

  /** Borra filas vencidas o revocadas hace más de DIAS_CONSERVAR_SESION días. */
  async limpiar(ahora: Date = new Date()) {
    const limite = new Date(ahora.getTime() - DIAS_CONSERVAR_SESION * DIA_MS);
    const { count } = await this.prisma.sesionMovil.deleteMany({
      where: { OR: [{ expiraEn: { lt: limite } }, { revocadaEn: { lt: limite } }] },
    });
    return { borradas: count };
  }

  @Cron('0 4 * * *', { name: 'limpieza-sesiones-moviles', timeZone: ZONA_NEGOCIO })
  async limpiezaDiaria(): Promise<void> {
    if (this.limpiando) return;
    this.limpiando = true;
    try {
      const { borradas } = await this.limpiar();
      this.logger.log(`Sesiones móviles borradas: ${borradas}`);
    } catch {
      this.logger.error('Falló la limpieza diaria de sesiones móviles');
    } finally {
      this.limpiando = false;
    }
  }
}
