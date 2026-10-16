import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventarioService } from '../inventario/inventario.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { horarioDeDiaSemana } from '../configuracion-sitio/horario.util';
import { containsSQLInjection, sanitizeInput } from '../common/utils/security.util';
import { normalizarRangoFechas } from '../common/utils/fecha-rango.util';
import { diaEnMexico, rangoDiaMexico } from '../common/utils/zona-mexico';
import { CreateCitaDto } from './dto/create-cita.dto';
import { UpdateCitaDto } from './dto/update-cita.dto';
import { ListCitasDto } from './dto/list-citas.dto';
import { ReprogramarCitaDto } from './dto/reprogramar-cita.dto';
import { CancelarCitaDto } from './dto/cancelar-cita.dto';
import { MaterialesCitaDto } from './dto/materiales-cita.dto';
import { DisponibilidadCitasDto } from './dto/disponibilidad-citas.dto';
import { CrearCitaSinCitaDto } from './dto/crear-cita-sin-cita.dto';
import { PorCobrarDto } from './dto/por-cobrar.dto';
import { AnticiposCitasService } from './anticipos/anticipos-citas.service';
import { instantaneaReglasCita, reglasDeCita, reglasNegocio } from '../configuracion-sitio/reglas-negocio';
import { assertPuedeEscribirCita, puedeEscribirCualquierCita, type Solicitante } from '../common/utils/permisos-citas.util';
import {
  ESTADOS_CITA_VIGENTE,
  EVENTO_ANTICIPO_REEMBOLSABLE,
  MOTIVO_ANTICIPO_NO_PAGADO,
  anticipoAplica,
  politicaCancelacionAnticipo,
  requiereAnticipo,
} from './anticipos/anticipos.util';

const ROLES_ESPECIALISTA = ['estilista', 'empleado', 'becario'] as const;
const ESTADOS_FINALES = ['cancelada', 'completada', 'no_asistio'] as const;
/**
 * Estados en los que una cita ocupa su horario. Única lista para validar solapamiento, la
 * disponibilidad y las especialistas libres: un slot es "libre" exactamente cuando `crear()` lo
 * aceptaría. Una reprogramada ocupa su horario nuevo igual que una cita nueva.
 */
const ESTADOS_OCUPAN_HORARIO = ['pendiente', 'confirmada', 'reprogramada', 'en_curso'] as const;
/** Estados desde los que se hace check-in: las citas vigentes que todavía no empiezan. */
const ESTADOS_ESPERAN_LLEGADA = ['pendiente', 'confirmada', 'reprogramada'] as const;
/** Holgado: la transacción puede esperar el candado de la especialista mientras otra escribe. */
const OPCIONES_TX_HORARIO = { timeout: 15_000 } as const;
/** Agendar o mover una cita con anticipo sin pagar pide al menos este margen antes del plazo (15 min antes del inicio). */
const MARGEN_MINIMO_ANTICIPO_MS = 5 * 60 * 1000;
/** Una clienta con un "no asistió" o un anticipo en salón sin pagar en estos meses paga el anticipo en línea. */
const MENSAJE_SIN_TIEMPO_ANTICIPO = 'Ya no da tiempo de pagar el anticipo antes de tu cita.';
const MENSAJE_CITA_COBRADA = 'La cita ya se cobró; no se puede editar ni reprogramar. Cancela la venta primero.';
const OFFSET_MEXICO = '-06:00';

@Injectable()
export class CitasService {
  private readonly logger = new Logger(CitasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventarioService: InventarioService,
    private readonly configuracionService: ConfiguracionService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly anticipos?: AnticiposCitasService,
  ) {}

  // ─── helpers ────────────────────────────────────────────────────────────────

  private incluirRelaciones() {
    return {
      cliente:     { select: { id: true, nombre: true, email: true, telefono: true } },
      especialista: { select: { id: true, nombre: true, rol: true } },
      servicio:    { select: { id: true, nombre: true, duracionMinutos: true, precio: true } },
      // Pagos del anticipo (en línea o en el salón): estado del anticipo en el portal, la agenda y el POS.
      pagos:       { select: { id: true, estado: true, monto: true, metodo: true, proveedor: true, pagadoEn: true, retenidoEn: true }, orderBy: { id: 'asc' } },
    } as const;
  }

  /**
   * Devuelve filtro WHERE de scope según el rol del solicitante.
   * Clientes solo ven sus propias citas. Staff (estilista/empleado/becario) y
   * admin ven todas las citas del salón — pueden acotar por especialista vía
   * el query param `especialistaId` (ver `listar`/`listarDia`/`listarCalendario`).
   */
  private aplicarScope(usuarioId: string, rolUsuario?: string, propios = false): Record<string, unknown> {
    // Portal de clienta: cualquier rol ve solo las citas donde es la clienta.
    if (rolUsuario === 'cliente' || propios) return { clienteId: usuarioId };
    return {};
  }

  /** Valida que no haya solapamiento de horario para el especialista. */
  private async validarSolapamiento(
    tx: Prisma.TransactionClient,
    especialistaId: string,
    inicio: Date,
    fin: Date,
    excluirId?: number,
  ) {
    const where: Record<string, unknown> = {
      especialistaId,
      estado: { in: [...ESTADOS_OCUPAN_HORARIO] },
      fechaHoraInicio: { lt: fin },
      fechaHoraFin:    { gt: inicio },
    };
    if (excluirId) where.id = { not: excluirId };

    const solapamiento = await tx.cita.findFirst({ where });
    if (solapamiento) {
      throw new BadRequestException(
        `El especialista ya tiene una cita en ese horario (cita #${solapamiento.id})`,
      );
    }
  }

  /**
   * Aparta un horario de la especialista: en una sola transacción toma un candado por especialista
   * (pg_advisory_xact_lock, se suelta solo al terminar), valida el solapamiento y escribe. Dos
   * movimientos simultáneos al mismo horario se forman en fila y el segundo ya ve al primero.
   * Los eventos se emiten afuera, después del commit.
   */
  private apartarHorario<T>(
    especialistaId: string,
    inicio: Date,
    fin: Date,
    excluirId: number | undefined,
    escribir: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const clave = `cita-esp:${especialistaId}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
      await this.validarSolapamiento(tx, especialistaId, inicio, fin, excluirId);
      return escribir(tx);
    }, OPCIONES_TX_HORARIO);
  }

  /** Horario del salón en un día 'YYYY-MM-DD' (hora de México), según la configuración; null si no abre. */
  private async horarioDelDia(fecha: string) {
    const { data: config } = await this.configuracionService.obtener();
    const [y, m, d] = fecha.split('-').map(Number);
    const diaSemana = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo … 6=sábado

    let entrada: string | null;
    let salida: string | null;
    // Horario por día de Configuración del sitio (fuente del sitio y de la agenda); sin él, el de configuracion_salon.
    const porDia = horarioDeDiaSemana((config as { horarioPorDia?: unknown }).horarioPorDia, diaSemana);
    if (porDia !== undefined) {
      entrada = porDia?.entrada ?? null;
      salida = porDia?.salida ?? null;
    } else if (diaSemana === 0) {
      entrada = config.entradaDomingo;
      salida = config.salidaDomingo;
    } else if (diaSemana === 6) {
      entrada = config.entradaSabado;
      salida = config.salidaSabado;
    } else {
      entrada = config.entradaLunesViernes;
      salida = config.salidaLunesViernes;
    }
    if (!entrada || !salida) return null;
    return {
      entrada,
      salida,
      inicio: new Date(`${fecha}T${entrada}:00${OFFSET_MEXICO}`),
      fin: new Date(`${fecha}T${salida}:00${OFFSET_MEXICO}`),
    };
  }

  /**
   * La cita cabe completa en el horario del salón del día en que empieza (mismo horario que ofrece
   * `disponibilidad`). Desde el portal, además, empieza en el futuro y dura lo que dura el servicio.
   */
  private async validarHorarioCita(inicio: Date, fin: Date, portal: boolean, duracionMinutos: number) {
    if (portal) {
      if (inicio.getTime() <= Date.now()) throw new BadRequestException('Elige un horario que todavía no haya pasado');
      if (fin.getTime() - inicio.getTime() !== duracionMinutos * 60_000) {
        throw new BadRequestException(`La cita debe durar ${duracionMinutos} minutos, lo que dura el servicio`);
      }
    }
    const horario = await this.horarioDelDia(diaEnMexico(inicio));
    if (!horario) throw new BadRequestException('El salón no abre ese día');
    if (inicio < horario.inicio || fin > horario.fin) {
      throw new BadRequestException(`La cita queda fuera del horario del salón (${horario.entrada} a ${horario.salida})`);
    }
  }

  /** Carga la cita para editarla: 404 si no existe, permisos y 409 si ya se cobró en el POS. */
  private async citaEditable(id: number, solicitante: Solicitante, propios = false) {
    const cita = await this.prisma.cita.findUnique({
      where: { id },
      include: { ventaItem: { select: { id: true } }, servicio: { select: { duracionMinutos: true } } },
    });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    assertPuedeEscribirCita(cita, solicitante, propios);
    if (cita.ventaItem != null) throw new ConflictException(MENSAJE_CITA_COBRADA);
    return cita;
  }

  /**
   * Escribe la cita solo si sigue sin cobrar, en el mismo UPDATE: si el POS la cobró entre la lectura
   * de `citaEditable` y esta escritura, responde el mismo 409 y no cambia nada.
   */
  private async escribirSiNoCobrada(tx: Prisma.TransactionClient, id: number, data: Prisma.CitaUncheckedUpdateManyInput) {
    const r = await tx.cita.updateMany({ where: { id, ventaItem: { is: null } }, data });
    if (r.count === 0) throw new ConflictException(MENSAJE_CITA_COBRADA);
    const cita = await tx.cita.findUnique({ where: { id }, include: this.incluirRelaciones() });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    return cita;
  }

  // ─── lecturas ────────────────────────────────────────────────────────────────

  async listar(query: ListCitasDto, usuarioId: string, rolUsuario?: string) {
    const page  = query.page  ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.estado)        where.estado        = query.estado;
    if (query.especialistaId) where.especialistaId = query.especialistaId;
    if (query.clienteId)     where.clienteId     = query.clienteId;
    if (query.desde || query.hasta) {
      where.fechaHoraInicio = normalizarRangoFechas(query.desde, query.hasta);
    }
    // El scope va al final: una clienta no puede pisarlo con ?clienteId= de otra persona.
    Object.assign(where, this.aplicarScope(usuarioId, rolUsuario, query.propios === true));

    const orderBy =
      query.orden === 'creadoEn'
        ? { creadoEn: 'desc' as const }
        : { fechaHoraInicio: 'asc' as const };

    const [total, citas] = await this.prisma.$transaction([
      this.prisma.cita.count({ where }),
      this.prisma.cita.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: this.incluirRelaciones(),
      }),
    ]);

    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: citas,
    };
  }

  async listarDia(fecha: string, usuarioId: string, rolUsuario?: string, especialistaId?: string) {
    if (!fecha) throw new BadRequestException('El parámetro fecha es requerido (YYYY-MM-DD)');
    const { gte: inicio, lte: fin } = normalizarRangoFechas(fecha, fecha);
    if (!inicio || !fin) throw new BadRequestException('Fecha inválida');

    const citas = await this.prisma.cita.findMany({
      where: {
        ...this.aplicarScope(usuarioId, rolUsuario),
        ...(especialistaId ? { especialistaId } : {}),
        fechaHoraInicio: { gte: inicio, lte: fin },
      },
      orderBy: { fechaHoraInicio: 'asc' },
      include: this.incluirRelaciones(),
    });

    return { success: true, count: citas.length, data: citas };
  }

  async listarCalendario(desde: string, hasta: string, usuarioId: string, rolUsuario?: string, especialistaId?: string) {
    if (!desde || !hasta) {
      throw new BadRequestException('Los parámetros desde y hasta son requeridos');
    }
    const { gte: fechaDesde, lte: fechaHasta } = normalizarRangoFechas(desde, hasta);
    if (!fechaDesde || !fechaHasta) {
      throw new BadRequestException('Fechas inválidas');
    }

    const citas = await this.prisma.cita.findMany({
      where: {
        ...this.aplicarScope(usuarioId, rolUsuario),
        ...(especialistaId ? { especialistaId } : {}),
        fechaHoraInicio: { gte: fechaDesde, lte: fechaHasta },
      },
      orderBy: { fechaHoraInicio: 'asc' },
      include: this.incluirRelaciones(),
    });

    return { success: true, count: citas.length, data: citas };
  }

  async obtener(id: number, usuarioId: string, rolUsuario?: string, propios = false) {
    const cita = await this.prisma.cita.findUnique({
      where: { id },
      include: this.incluirRelaciones(),
    });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    // Portal de clienta: la cita ajena responde 404 para cualquier rol (no revela que existe).
    if (propios && cita.clienteId !== usuarioId) throw new NotFoundException(`Cita ${id} no encontrada`);

    if (rolUsuario === 'cliente' && cita.clienteId !== usuarioId) {
      throw new ForbiddenException('No tienes acceso a esta cita');
    }

    return { success: true, data: cita };
  }

  /**
   * Especialistas para que el cliente elija al agendar — solo lo mínimo para decidir.
   * Nunca email/teléfono (staff, no se expone al público); `puesto`/`especialidades`
   * son reales de `PerfilEmpleado` cuando existe, nunca inventados.
   * Parte de `PerfilEmpleado` (no de `Usuario`) para exigir perfil.activo Y
   * usuario.activo — son condiciones distintas, un perfil puede estar de baja
   * con la cuenta todavía activa.
   */
  async listarEspecialistas() {
    const perfiles = await this.prisma.perfilEmpleado.findMany({
      where: { activo: true, usuario: { activo: true, rol: { in: [...ROLES_ESPECIALISTA] } } },
      select: {
        puesto: true,
        especialidades: true,
        usuario: { select: { id: true, nombre: true, foto: true } },
      },
      orderBy: { usuario: { nombre: 'asc' } },
    });

    const data = perfiles.map((p) => ({
      id: p.usuario.id,
      nombre: p.usuario.nombre,
      foto: p.usuario.foto,
      puesto: p.puesto,
      especialidades: p.especialidades,
    }));

    return { success: true, count: data.length, data };
  }

  /**
   * Slots libres de un especialista en una fecha, para un servicio (su duración real).
   * Reutiliza `ConfiguracionService` (horario del salón), `normalizarRangoFechas`
   * (mismo criterio de timezone que `listarDia`) y los mismos estados que bloquean
   * solapamiento en `validarSolapamiento` — nada de lógica nueva de timezone/estado.
   */
  async disponibilidad(query: DisponibilidadCitasDto) {
    const { especialistaId, fecha, servicioId } = query;

    const especialista = await this.prisma.usuario.findUnique({
      where: { id: especialistaId },
      select: { id: true, rol: true, activo: true },
    });
    if (!especialista || !especialista.activo || !ROLES_ESPECIALISTA.includes(especialista.rol as any)) {
      throw new NotFoundException('Especialista no encontrado o inactivo');
    }

    const servicio = await this.prisma.servicio.findUnique({
      where: { id: servicioId },
      select: { id: true, activo: true, duracionMinutos: true },
    });
    if (!servicio || !servicio.activo) {
      throw new NotFoundException('Servicio no encontrado o inactivo');
    }
    const duracionMinutos = servicio.duracionMinutos;

    const horario = await this.horarioDelDia(fecha);

    const base = {
      success: true,
      fecha,
      especialistaId,
      servicioId,
      duracionMinutos,
    };

    if (!horario) {
      return { ...base, abierto: false, motivo: 'El salón no abre ese día', slots: [] };
    }

    const { inicio: inicioDia, fin: finDia } = horario;

    const { gte, lte } = normalizarRangoFechas(fecha, fecha);
    const citasDelDia = await this.prisma.cita.findMany({
      where: {
        especialistaId,
        estado: { in: [...ESTADOS_OCUPAN_HORARIO] },
        fechaHoraInicio: { gte, lte },
      },
      select: { fechaHoraInicio: true, fechaHoraFin: true },
    });

    const ahora = new Date();
    const slots: { inicio: string; fin: string; horaLocal: string }[] = [];
    const duracionMs = duracionMinutos * 60_000;
    const intervaloMs = reglasNegocio().citas.intervaloHorariosMinutos * 60_000;

    for (let inicio = inicioDia.getTime(); inicio + duracionMs <= finDia.getTime(); inicio += intervaloMs) {
      const inicioSlot = new Date(inicio);
      const finSlot = new Date(inicio + duracionMs);

      if (inicioSlot <= ahora) continue;

      const seSolapa = citasDelDia.some(
        (c) => inicioSlot < c.fechaHoraFin && finSlot > c.fechaHoraInicio,
      );
      if (seSolapa) continue;

      slots.push({
        inicio: inicioSlot.toISOString(),
        fin: finSlot.toISOString(),
        horaLocal: inicioSlot.toLocaleTimeString('es-MX', {
          timeZone: 'America/Mexico_City',
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    }

    return { ...base, abierto: true, motivo: null, slots };
  }

  /**
   * Personal que puede hacer el servicio y está libre ahora. Si el servicio tiene especialistas asignadas
   * (servicio_especialistas) solo cuentan ellas; si no tiene ninguna, cuenta todo el personal que atiende.
   * Ocupada = con una cita en curso de hoy (hora de México; una de días pasados que nadie cerró ya no
   * cuenta), o con una cita que ocupa horario y choca con [ahora, ahora + duración].
   */
  async especialistasLibres(servicioId: number) {
    const servicio = await this.prisma.servicio.findUnique({
      where: { id: servicioId },
      select: { id: true, activo: true, duracionMinutos: true },
    });
    if (!servicio || !servicio.activo) throw new NotFoundException('Servicio no encontrado o inactivo');

    const asignadas = await this.prisma.servicioEspecialista.findMany({
      where: { servicioId },
      select: { usuarioId: true },
    });
    const candidatas = await this.prisma.usuario.findMany({
      where: {
        activo: true,
        rol: { in: [...ROLES_ESPECIALISTA] },
        ...(asignadas.length > 0 ? { id: { in: asignadas.map((a) => a.usuarioId) } } : {}),
      },
      select: { id: true, nombre: true, foto: true },
      orderBy: { nombre: 'asc' },
    });
    if (candidatas.length === 0) return { success: true, count: 0, data: [] };

    const ahora = new Date();
    const fin = new Date(ahora.getTime() + servicio.duracionMinutos * 60_000);
    const hoy = rangoDiaMexico(diaEnMexico(ahora));
    const ocupadas = await this.prisma.cita.findMany({
      where: {
        especialistaId: { in: candidatas.map((c) => c.id) },
        OR: [
          { estado: 'en_curso', fechaHoraInicio: { gte: hoy.desde, lte: hoy.hasta } },
          { estado: { in: [...ESTADOS_OCUPAN_HORARIO] }, fechaHoraInicio: { lt: fin }, fechaHoraFin: { gt: ahora } },
        ],
      },
      select: { especialistaId: true },
    });
    const idsOcupadas = new Set(ocupadas.map((c) => c.especialistaId));
    const data = candidatas.filter((c) => !idsOcupadas.has(c.id));
    return { success: true, count: data.length, data };
  }

  /** Personal activo que atiende (estilista, empleado, becario): para elegir participantes al cobrar. */
  async personal() {
    const data = await this.prisma.usuario.findMany({
      where: { activo: true, rol: { in: [...ROLES_ESPECIALISTA] } },
      select: { id: true, nombre: true, foto: true },
      orderBy: { nombre: 'asc' },
    });
    return { success: true, count: data.length, data };
  }

  /**
   * Citas finalizadas en el flujo nuevo (con hora de salida) que todavía no se cobraron, paginadas.
   * Con citaId busca solo esa cita (el POS la abre directo desde la agenda).
   */
  async porCobrar(query: PorCobrarDto = {}) {
    const page  = query.page  ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: Prisma.CitaWhereInput = { estado: 'completada', horaCheckOut: { not: null }, ventaItem: null };
    if (query.citaId !== undefined) where.id = query.citaId;

    const [total, citas] = await this.prisma.$transaction([
      this.prisma.cita.count({ where }),
      this.prisma.cita.findMany({
        where,
        include: this.incluirRelaciones(),
        orderBy: [{ horaCheckOut: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: citas,
    };
  }

  // ─── escrituras ──────────────────────────────────────────────────────────────

  /**
   * Turno de alguien que llega sin cita: cita inmediata (ahora + duración del servicio) con origen
   * sin_cita. Persona sin cuenta: nombre (y teléfono). Clienta registrada: clienteId.
   */
  async crearSinCita(dto: CrearCitaSinCitaDto) {
    const nombre = dto.nombre ? sanitizeInput(dto.nombre).trim() : '';
    if (!dto.clienteId && !nombre) {
      throw new BadRequestException('Indica el nombre de la persona o elige a una clienta registrada');
    }

    const especialista = await this.prisma.usuario.findUnique({
      where: { id: dto.especialistaId },
      select: { id: true, rol: true, activo: true },
    });
    if (!especialista || !especialista.activo || !ROLES_ESPECIALISTA.includes(especialista.rol as any)) {
      throw new NotFoundException('Especialista no encontrada o inactiva');
    }

    if (dto.clienteId) {
      const cliente = await this.prisma.usuario.findUnique({ where: { id: dto.clienteId }, select: { id: true, activo: true } });
      if (!cliente || !cliente.activo) throw new NotFoundException('Clienta no encontrada o inactiva');
    }

    const servicio = await this.prisma.servicio.findUnique({
      where: { id: dto.servicioId },
      select: { id: true, activo: true, duracionMinutos: true },
    });
    if (!servicio || !servicio.activo) throw new NotFoundException('Servicio no encontrado o inactivo');

    const inicio = new Date();
    const fin = new Date(inicio.getTime() + servicio.duracionMinutos * 60_000);

    const notas = dto.notas ? sanitizeInput(dto.notas) : null;
    if (notas && containsSQLInjection(notas)) throw new BadRequestException('Las notas contienen caracteres no permitidos');

    const cita = await this.apartarHorario(dto.especialistaId, inicio, fin, undefined, (tx) => tx.cita.create({
      data: {
        clienteId: dto.clienteId ?? null,
        nombreInvitado: dto.clienteId ? null : nombre,
        telefonoInvitado: dto.clienteId ? null : dto.telefono?.trim() || null,
        origen: 'sin_cita',
        especialistaId: dto.especialistaId,
        servicioId: dto.servicioId,
        fechaHoraInicio: inicio,
        fechaHoraFin: fin,
        estado: dto.iniciarAhora ? 'en_curso' : 'pendiente',
        horaCheckIn: dto.iniciarAhora ? inicio : null,
        notas,
      },
      include: this.incluirRelaciones(),
    }));

    // La especialista recibe su aviso; la clienta solo si tiene cuenta (el listener omite la parte sin cliente).
    this.eventEmitter.emit('cita.creada', {
      citaId: cita.id,
      clienteId: cita.clienteId,
      especialistaId: cita.especialistaId,
      servicioNombre: cita.servicio.nombre,
      fechaHoraInicio: cita.fechaHoraInicio,
    });

    return { success: true, data: cita };
  }

  async crear(dto: CreateCitaDto, solicitante: Solicitante, propios = false) {
    // Desde el portal, o sin 'citas:escritura' (clienta, becario), la cita es siempre de quien la crea.
    // Solo el personal con escritura agenda a nombre de otra clienta, y solo desde su panel.
    const clienteId = propios || !puedeEscribirCualquierCita(solicitante) ? solicitante.id : dto.clienteId;

    // Validar especialista
    const especialista = await this.prisma.usuario.findUnique({
      where: { id: dto.especialistaId },
      select: { id: true, rol: true, activo: true },
    });
    if (!especialista || !especialista.activo) {
      throw new NotFoundException('Especialista no encontrado o inactivo');
    }
    if (!ROLES_ESPECIALISTA.includes(especialista.rol as any)) {
      throw new BadRequestException(
        `El usuario asignado no es un especialista válido (roles válidos: ${ROLES_ESPECIALISTA.join(', ')})`,
      );
    }

    // Validar cliente
    const cliente = await this.prisma.usuario.findUnique({
      where: { id: clienteId },
      select: { id: true, activo: true },
    });
    if (!cliente || !cliente.activo) throw new NotFoundException('Cliente no encontrado o inactivo');

    // Validar servicio
    const servicio = await this.prisma.servicio.findUnique({
      where: { id: dto.servicioId },
      select: { id: true, activo: true, anticipoMonto: true, duracionMinutos: true },
    });
    if (!servicio || !servicio.activo) throw new NotFoundException('Servicio no encontrado o inactivo');

    const fechaHoraInicio = new Date(dto.fechaHoraInicio);
    const fechaHoraFin    = new Date(dto.fechaHoraFin);
    if (fechaHoraFin <= fechaHoraInicio) {
      throw new BadRequestException('La fecha de fin debe ser posterior a la de inicio');
    }

    // Anticipo: al agendar en línea (portal, o quien no tiene escritura) si el servicio lo pide; desde
    // /operacion solo si el personal lo marca. Se guarda la foto del monto y el plazo para pagarlo:
    // en línea, el plazo de la regla sin pasar del límite del salón; en el salón, los minutos antes del inicio de la regla.
    const enLinea = propios || !puedeEscribirCualquierCita(solicitante);
    // Misma regla que `anticipoAplica` de GET /servicios (lo que la web anuncia).
    const pideAnticipo = (enLinea || dto.pedirAnticipo === true) && anticipoAplica(servicio);
    // Desde el portal (propios) la clienta tiene límites para no acaparar horarios; el personal no.
    let anticipo: Pick<Prisma.CitaUncheckedCreateInput, 'anticipoRequerido' | 'anticipoVenceEn' | 'anticipoEnSalon'> = {};
    const reglas = reglasNegocio();
    if (pideAnticipo) {
      const ahora = new Date();
      const limiteSalon = fechaHoraInicio.getTime() - reglas.citas.minutosAntesPagoSalon * 60_000;
      const sinMargen = limiteSalon - ahora.getTime() < MARGEN_MINIMO_ANTICIPO_MS;
      if (dto.pagoAnticipo === 'salon') {
        if (!reglas.citas.permitirAnticipoEnSalon) throw new BadRequestException('El anticipo se paga en línea.');
        if (sinMargen) throw new BadRequestException('Ya no da tiempo de pagar en el salón. Paga el anticipo en línea.');
        if (propios && reglas.citas.noAsistio.mesesSoloPagoEnLinea > 0) {
          const desde = new Date(ahora);
          desde.setMonth(desde.getMonth() - reglas.citas.noAsistio.mesesSoloPagoEnLinea);
          // Faltas: no asistió, o la barrida liberó una cita con anticipo en salón sin pagar (otras cancelaciones no cuentan).
          const faltas = await this.prisma.cita.count({
            where: {
              clienteId,
              fechaHoraInicio: { gte: desde },
              OR: [{ estado: 'no_asistio' }, { estado: 'cancelada', motivoCancelacion: MOTIVO_ANTICIPO_NO_PAGADO, anticipoEnSalon: true }],
            },
          });
          if (faltas > 0) throw new BadRequestException('Para esta cita, el anticipo se paga en línea.');
        }
        anticipo = { anticipoRequerido: servicio.anticipoMonto, anticipoVenceEn: new Date(limiteSalon), anticipoEnSalon: true };
      } else {
        if (!reglas.pagos.mercadoPagoAnticipos) {
          throw new BadRequestException('El pago del anticipo en línea no está disponible por ahora. Elige pagarlo en el salón.');
        }
        if (propios && sinMargen) throw new BadRequestException(MENSAJE_SIN_TIEMPO_ANTICIPO);
        const vence = Math.min(ahora.getTime() + reglas.citas.plazoAnticipoHoras * 60 * 60_000, limiteSalon);
        anticipo = { anticipoRequerido: servicio.anticipoMonto, anticipoVenceEn: new Date(vence) };
      }
    }

    // Portal: la cuenta de clienta o ?propios=true (el personal registra desde su panel citas pasadas o de otra duración).
    await this.validarHorarioCita(fechaHoraInicio, fechaHoraFin, propios || solicitante.rol === 'cliente', servicio.duracionMinutos);

    const notas = dto.notas ? sanitizeInput(dto.notas) : null;
    if (notas && containsSQLInjection(notas)) {
      throw new BadRequestException('Las notas contienen caracteres no permitidos');
    }

    // Una sola cita por pagar en el salón por clienta (portal). Se revisa en la transacción con un candado
    // por clienta (siempre después del de la especialista), para que dos solicitudes a la vez no pasen las dos.
    const unaPorPagarEnSalon = propios && anticipo.anticipoEnSalon === true;
    const cita = await this.apartarHorario(dto.especialistaId, fechaHoraInicio, fechaHoraFin, undefined, async (tx) => {
      if (unaPorPagarEnSalon) {
        const clave = `cita-cli:${clienteId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
        const porPagar = await tx.cita.count({
          where: { clienteId, anticipoEnSalon: true, anticipoPagadoEn: null, anticipoRequerido: { gt: 0 }, estado: { in: [...ESTADOS_CITA_VIGENTE] } },
        });
        if (porPagar >= reglas.citas.maxCitasPorPagarEnSalon) {
          throw new BadRequestException(reglas.citas.maxCitasPorPagarEnSalon === 1
            ? 'Ya tienes una cita por pagar en el salón. Paga su anticipo o elige pagar en línea.'
            : `Ya tienes ${reglas.citas.maxCitasPorPagarEnSalon} citas por pagar en el salón. Paga su anticipo o elige pagar en línea.`);
        }
      }
      return tx.cita.create({
        // La cita guarda las reglas con que se creó: un cambio posterior no la afecta.
        data: { clienteId, especialistaId: dto.especialistaId, servicioId: dto.servicioId, fechaHoraInicio, fechaHoraFin, notas, ...anticipo, reglas: instantaneaReglasCita(reglas) as unknown as Prisma.InputJsonValue },
        include: this.incluirRelaciones(),
      });
    });

    // Después del commit: notificar es un efecto secundario, nunca debe poder afectar la creación de la cita.
    this.eventEmitter.emit('cita.creada', {
      citaId: cita.id,
      clienteId: cita.clienteId,
      especialistaId: cita.especialistaId,
      servicioNombre: cita.servicio.nombre,
      fechaHoraInicio: cita.fechaHoraInicio,
    });

    return { success: true, data: cita };
  }

  async actualizar(id: number, dto: UpdateCitaDto, solicitante: Solicitante) {
    const cita = await this.citaEditable(id, solicitante);
    // Quien solo edita sus citas asignadas (becario) no puede pasárselas a otra persona.
    if (
      dto.especialistaId !== undefined &&
      dto.especialistaId !== cita.especialistaId &&
      !puedeEscribirCualquierCita(solicitante)
    ) {
      throw new ForbiddenException('No puedes reasignar la cita a otra especialista');
    }

    const data: Prisma.CitaUncheckedUpdateManyInput = {};

    if (dto.especialistaId !== undefined) {
      const esp = await this.prisma.usuario.findUnique({
        where: { id: dto.especialistaId },
        select: { id: true, rol: true, activo: true },
      });
      if (!esp || !esp.activo) throw new NotFoundException('Especialista no encontrado');
      if (!ROLES_ESPECIALISTA.includes(esp.rol as any)) {
        throw new BadRequestException('El usuario asignado no es un especialista válido');
      }
      data.especialistaId = dto.especialistaId;
    }
    if (dto.servicioId !== undefined) data.servicioId = dto.servicioId;
    if (dto.estado     !== undefined) data.estado     = dto.estado as Prisma.CitaUncheckedUpdateManyInput['estado'];
    // Completarla a mano (sin check-out) también registra la salida, para que el POS la vea por cobrar.
    if (dto.estado === 'completada' && !cita.horaCheckOut) data.horaCheckOut = new Date();
    if (dto.notas      !== undefined) {
      const notasLimpias = sanitizeInput(dto.notas);
      if (containsSQLInjection(notasLimpias)) throw new BadRequestException('Notas inválidas');
      data.notas = notasLimpias;
    }

    const cambianFechas = dto.fechaHoraInicio !== undefined || dto.fechaHoraFin !== undefined;
    const nuevaInicio   = dto.fechaHoraInicio ? new Date(dto.fechaHoraInicio) : cita.fechaHoraInicio;
    const nuevaFin      = dto.fechaHoraFin    ? new Date(dto.fechaHoraFin)    : cita.fechaHoraFin;
    if (cambianFechas) {
      if (nuevaFin <= nuevaInicio) throw new BadRequestException('La fecha de fin debe ser posterior a la de inicio');
      data.fechaHoraInicio = nuevaInicio;
      data.fechaHoraFin    = nuevaFin;
    }

    // Mover el horario, o pasar a otra especialista una cita que ocupa horario, lo aparta igual que
    // una cita nueva (candado, solapamiento y escritura en la misma transacción).
    const especialistaId = (dto.especialistaId ?? cita.especialistaId) as string;
    const estadoFinal = dto.estado ?? cita.estado;
    const ocupaOtraAgenda = especialistaId !== cita.especialistaId && ESTADOS_OCUPAN_HORARIO.includes(estadoFinal as any);
    const escribir = (tx: Prisma.TransactionClient) => this.escribirSiNoCobrada(tx, id, data);

    const actualizada = cambianFechas || ocupaOtraAgenda
      ? await this.apartarHorario(especialistaId, nuevaInicio, nuevaFin, id, escribir)
      : await escribir(this.prisma);
    return { success: true, data: actualizada };
  }

  async checkIn(id: number, solicitante: Solicitante) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    assertPuedeEscribirCita(cita, solicitante);
    if (!ESTADOS_ESPERAN_LLEGADA.includes(cita.estado as any)) {
      throw new BadRequestException(`No se puede hacer check-in en estado '${cita.estado}'`);
    }
    const actualizada = await this.prisma.cita.update({
      where: { id },
      data: { estado: 'en_curso', horaCheckIn: new Date() },
      include: this.incluirRelaciones(),
    });
    return { success: true, data: actualizada };
  }

  async checkOut(id: number, solicitante: Solicitante) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    assertPuedeEscribirCita(cita, solicitante);
    if (cita.estado !== 'en_curso') {
      throw new BadRequestException(`Solo se puede hacer check-out de citas en estado 'en_curso'`);
    }
    const actualizada = await this.prisma.cita.update({
      where: { id },
      data: { estado: 'completada', horaCheckOut: new Date() },
      include: this.incluirRelaciones(),
    });
    return { success: true, data: actualizada };
  }

  /**
   * Mueve la cita a otro horario con la misma validación que una cita nueva (fin después del inicio,
   * dentro del horario del salón, notas limpias, sin encimarse con otra cita de la especialista y con
   * el mismo candado). El anticipo se conserva (anticipoRequerido y anticipoPagadoEn no cambian), salvo una cita con pago en
   * el salón aún sin pagar: su plazo pasa a 15 min antes del nuevo inicio. Una cita con pago en línea
   * conserva su plazo y una ya pagada no cambia.
   */
  async reprogramar(id: number, dto: ReprogramarCitaDto, solicitante: Solicitante, propios = false) {
    const cita = await this.citaEditable(id, solicitante, propios);
    if (ESTADOS_FINALES.includes(cita.estado as any)) {
      throw new BadRequestException(`No se puede reprogramar una cita en estado '${cita.estado}'`);
    }
    // Desde el portal, con menos aviso del que pide la regla de la cita, se reagenda con el salón (el personal sí puede).
    const horasAviso = reglasDeCita(cita.reglas).horasAvisoCancelarReagendar;
    if (propios && horasAviso > 0 && cita.fechaHoraInicio && cita.fechaHoraInicio.getTime() - Date.now() < horasAviso * 60 * 60_000) {
      throw new BadRequestException(`Para reagendar con menos de ${horasAviso} horas de anticipación, comunícate con el salón.`);
    }

    const fechaHoraInicio = new Date(dto.fechaHoraInicio);
    const fechaHoraFin    = new Date(dto.fechaHoraFin);
    if (fechaHoraFin <= fechaHoraInicio) {
      throw new BadRequestException('La fecha de fin debe ser posterior a la de inicio');
    }

    const notas = dto.notas !== undefined ? sanitizeInput(dto.notas) : cita.notas;
    if (dto.notas !== undefined && notas && containsSQLInjection(notas)) {
      throw new BadRequestException('Las notas contienen caracteres no permitidos');
    }

    // Desde el portal, una cita con anticipo sin pagar no se mueve a un horario sin tiempo para pagarlo.
    const anticipoSinPagar = requiereAnticipo(cita) && cita.anticipoPagadoEn == null;
    const antesSalonMs = reglasDeCita(cita.reglas).minutosAntesPagoSalon * 60_000;
    if (propios && anticipoSinPagar && fechaHoraInicio.getTime() - antesSalonMs - Date.now() < MARGEN_MINIMO_ANTICIPO_MS) {
      throw new BadRequestException(MENSAJE_SIN_TIEMPO_ANTICIPO);
    }
    await this.validarHorarioCita(fechaHoraInicio, fechaHoraFin, propios || solicitante.rol === 'cliente', cita.servicio.duracionMinutos);

    // Pago en el salón sin pagar: el plazo sigue al nuevo inicio. Condicional en el mismo UPDATE para no
    // tocar una cita que se pagó entre la lectura y la escritura. Va antes de escribirSiNoCobrada, que
    // relee la cita para la respuesta.
    const muevePlazoSalon = cita.anticipoEnSalon && anticipoSinPagar;
    const actualizada = await this.apartarHorario(cita.especialistaId, fechaHoraInicio, fechaHoraFin, id, async (tx) => {
      if (muevePlazoSalon) {
        await tx.cita.updateMany({
          where: { id, anticipoEnSalon: true, anticipoPagadoEn: null, anticipoRequerido: { gt: 0 } },
          data: { anticipoVenceEn: new Date(fechaHoraInicio.getTime() - antesSalonMs) },
        });
      }
      return this.escribirSiNoCobrada(tx, id, { fechaHoraInicio, fechaHoraFin, estado: 'reprogramada', notas });
    });

    // Después del commit de la transacción: la cita ya está comprometida en BD.
    this.eventEmitter.emit('cita.reprogramada', {
      citaId: actualizada.id,
      clienteId: actualizada.clienteId,
      especialistaId: actualizada.especialistaId,
      servicioNombre: actualizada.servicio.nombre,
      fechaHoraInicioNueva: actualizada.fechaHoraInicio,
    });

    return { success: true, data: actualizada };
  }

  /**
   * La clienta elige pagar en el salón el anticipo de una cita que apartó para pagar en línea (confirmación o
   * detalle). Mismas reglas que al agendar con "pagar en el salón": a más tardar 15 min antes del inicio, sin faltas
   * en los últimos 6 meses y una sola cita por pagar en el salón. El plazo pasa a 15 min antes del inicio.
   */
  async pagarAnticipoEnSalon(id: number, solicitante: Solicitante) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    // Solo la dueña; la ajena responde 404 para no revelar que existe.
    if (!cita || cita.clienteId !== solicitante.id) throw new NotFoundException(`Cita ${id} no encontrada`);
    const ahora = new Date();
    if (
      !requiereAnticipo(cita) ||
      cita.anticipoPagadoEn ||
      cita.anticipoEnSalon ||
      !(ESTADOS_CITA_VIGENTE as readonly string[]).includes(cita.estado) ||
      !cita.anticipoVenceEn ||
      cita.anticipoVenceEn <= ahora
    ) {
      throw new ConflictException('El anticipo de esta cita ya no se puede cambiar a pago en el salón.');
    }
    const reglas = reglasNegocio();
    if (!reglas.citas.permitirAnticipoEnSalon) throw new BadRequestException('El anticipo se paga en línea.');
    const limiteSalon = new Date(cita.fechaHoraInicio.getTime() - reglasDeCita(cita.reglas).minutosAntesPagoSalon * 60_000);
    if (limiteSalon.getTime() - ahora.getTime() < MARGEN_MINIMO_ANTICIPO_MS) {
      throw new BadRequestException('Ya no da tiempo de pagar en el salón. Paga el anticipo en línea.');
    }
    const desde = new Date(ahora);
    desde.setMonth(desde.getMonth() - reglas.citas.noAsistio.mesesSoloPagoEnLinea);
    // Con el pago en línea de anticipos apagado, el salón es la única forma de pagar esta cita ya agendada: no se le
    // niega por faltas anteriores (si no, la barrida la liberaría sin que pudiera pagar).
    const sinPagoEnLinea = !reglas.pagos.mercadoPagoAnticipos;
    const faltas = sinPagoEnLinea || reglas.citas.noAsistio.mesesSoloPagoEnLinea <= 0 ? 0 : await this.prisma.cita.count({
      where: {
        clienteId: cita.clienteId,
        fechaHoraInicio: { gte: desde },
        OR: [{ estado: 'no_asistio' }, { estado: 'cancelada', motivoCancelacion: MOTIVO_ANTICIPO_NO_PAGADO, anticipoEnSalon: true }],
      },
    });
    if (faltas > 0) throw new BadRequestException('Para esta cita, el anticipo se paga en línea.');
    await this.revisarPagoEnLineaAntesDelSalon(id);
    return this.prisma.$transaction(async (tx) => {
      // Mismo candado por clienta que al agendar: dos solicitudes a la vez no dejan dos citas por pagar en el salón.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cita-cli:${cita.clienteId}`}))`;
      const porPagar = await tx.cita.count({
        where: { clienteId: cita.clienteId, id: { not: id }, anticipoEnSalon: true, anticipoPagadoEn: null, anticipoRequerido: { gt: 0 }, estado: { in: [...ESTADOS_CITA_VIGENTE] } },
      });
      if (!sinPagoEnLinea && porPagar >= reglas.citas.maxCitasPorPagarEnSalon) {
        throw new BadRequestException(reglas.citas.maxCitasPorPagarEnSalon === 1
          ? 'Ya tienes una cita por pagar en el salón. Paga su anticipo o paga esta en línea.'
          : `Ya tienes ${reglas.citas.maxCitasPorPagarEnSalon} citas por pagar en el salón. Paga su anticipo o paga esta en línea.`);
      }
      const cambiada = await tx.cita.updateMany({
        where: { id, anticipoPagadoEn: null, anticipoEnSalon: false },
        data: { anticipoEnSalon: true, anticipoVenceEn: limiteSalon },
      });
      if (cambiada.count !== 1) throw new ConflictException('El anticipo de esta cita ya no se puede cambiar a pago en el salón.');
      return { success: true, citaId: id, anticipoEnSalon: true, anticipoVenceEn: limiteSalon };
    }, OPCIONES_TX_HORARIO);
  }

  /**
   * La clienta pudo pagar en Mercado Pago sin que el aviso llegara: si el pago está aprobado se aplica y no se
   * cambia (no paga dos veces); si está en proceso, tampoco. Sin respuesta de Mercado Pago no se cambia: no se
   * puede confirmar que no pagó. Sin Mercado Pago configurado no hay pagos en línea que revisar.
   */
  private async revisarPagoEnLineaAntesDelSalon(id: number) {
    if (!this.anticipos || !process.env.MP_ACCESS_TOKEN) return;
    let enLinea: Awaited<ReturnType<AnticiposCitasService['revisarPagoEnLinea']>>;
    try {
      enLinea = await this.anticipos.revisarPagoEnLinea(id);
    } catch (e) {
      this.logger.warn(`No se pudo revisar en Mercado Pago el anticipo de la cita ${id}: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('No pudimos confirmar con Mercado Pago si ya pagaste el anticipo. Intenta de nuevo en unos minutos.');
    }
    if (enLinea === 'pagado') throw new ConflictException('Tu anticipo ya se pagó en línea: no tienes que pagarlo en el salón.');
    if (enLinea === 'en_proceso') {
      throw new ConflictException('Tienes un pago en línea en proceso para este anticipo. Espera su confirmación antes de cambiar a pago en el salón.');
    }
  }

  async cancelar(id: number, dto: CancelarCitaDto, solicitante: Solicitante, propios = false) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    assertPuedeEscribirCita(cita, solicitante, propios);
    if (ESTADOS_FINALES.includes(cita.estado as any)) {
      throw new BadRequestException(`No se puede cancelar una cita en estado '${cita.estado}'`);
    }

    const motivoLimpio = sanitizeInput(dto.motivoCancelacion);
    if (containsSQLInjection(motivoLimpio)) {
      throw new BadRequestException('El motivo contiene caracteres no permitidos');
    }

    const actualizada = await this.prisma.cita.update({
      where: { id },
      data: { estado: 'cancelada', motivoCancelacion: motivoLimpio },
      include: this.incluirRelaciones(),
    });

    this.eventEmitter.emit('cita.cancelada', {
      citaId: actualizada.id,
      clienteId: actualizada.clienteId,
      especialistaId: actualizada.especialistaId,
      motivo: motivoLimpio,
    });

    // La clienta canceló una cita con anticipo pagado. Política de anticipos (art. 56 LFPC): si la cita está a
    // más de 10 días hábiles del pago y cancela dentro de los 5 días hábiles siguientes, no se retiene y se le
    // devuelve (AnticiposCitasService reembolsa solo el pago en línea; el del salón lo reembolsa el personal).
    // En cualquier otro caso se retiene (Términos, sección 6): sigue 'aprobado' y queda firme. Si cancela el
    // salón, el personal lo reembolsa.
    const comoClienta = cita.clienteId === solicitante.id && (propios || !puedeEscribirCualquierCita(solicitante));
    if (comoClienta && requiereAnticipo(cita)) {
      const pagoAprobado = await this.prisma.pago.findFirst({
        where: { citaId: id, estado: 'aprobado', retenidoEn: null },
        orderBy: { id: 'desc' },
        select: { pagadoEn: true },
      });
      // Con las reglas que se guardaron en la cita al crearla: un cambio posterior no la afecta.
      const politica = politicaCancelacionAnticipo(pagoAprobado?.pagadoEn ?? cita.anticipoPagadoEn, cita.fechaHoraInicio, new Date(), reglasDeCita(cita.reglas));
      if (pagoAprobado && politica?.reembolsable) {
        this.eventEmitter.emit(EVENTO_ANTICIPO_REEMBOLSABLE, { citaId: id, solicitanteId: solicitante.id });
      } else {
        // Sin depender de anticipoPagadoEn leído antes: si el webhook lo marcó justo ahora, el pago también se retiene.
        await this.prisma.pago.updateMany({
          where: { citaId: id, estado: 'aprobado', retenidoEn: null },
          data: { retenidoEn: new Date() },
        });
      }
    }

    return { success: true, data: actualizada };
  }

  /**
   * La clienta no llegó: la cita queda 'no_asistio' (libera el horario) y el anticipo pagado se retiene
   * (Términos, sección 6). Solo desde una cita que seguía vigente.
   */
  async marcarNoAsistio(id: number, solicitanteId?: string) {
    const r = await this.prisma.cita.updateMany({
      where: { id, estado: { in: ['pendiente', 'confirmada', 'reprogramada'] } },
      data: { estado: 'no_asistio' },
    });
    if (r.count !== 1) {
      const existe = await this.prisma.cita.findUnique({ where: { id } });
      if (!existe) throw new NotFoundException(`Cita ${id} no encontrada`);
      throw new BadRequestException(`No se puede marcar "no asistió" una cita en estado '${existe.estado}'`);
    }
    const cita = await this.prisma.cita.findUnique({ where: { id }, include: this.incluirRelaciones() });
    // Si la regla con que se creó la cita dice que no se pierde el anticipo al no llegar, queda para reembolso.
    if (cita && requiereAnticipo(cita) && !reglasDeCita(cita.reglas).pierdeAnticipoSiNoAsiste) {
      const pagoAprobado = await this.prisma.pago.findFirst({ where: { citaId: id, estado: 'aprobado', retenidoEn: null }, select: { id: true } });
      if (pagoAprobado && solicitanteId) this.eventEmitter.emit(EVENTO_ANTICIPO_REEMBOLSABLE, { citaId: id, solicitanteId, noAsistio: true });
    }
    return { success: true, data: cita };
  }

  async registrarMateriales(id: number, dto: MaterialesCitaDto, solicitante: Solicitante) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    assertPuedeEscribirCita(cita, solicitante);
    const usuarioId = solicitante.id;
    if (!['en_curso', 'completada'].includes(cita.estado)) {
      throw new BadRequestException(
        'Solo se pueden registrar materiales en citas en_curso o completadas',
      );
    }

    // Todas las salidas en una sola transacción: si una falla (stock insuficiente),
    // no queda inventario parcialmente descontado.
    const resultados = await this.prisma.$transaction(async (tx) => {
      const acc = [];
      for (const material of dto.materiales) {
        const res = await this.inventarioService.registrarSalida(
          {
            presentacionId: material.presentacionId,
            cantidad:       material.cantidad,
            motivo:         'uso en cita',
            referenciaTipo: 'cita',
            referenciaId:   cita.id.toString(),
          },
          usuarioId,
          tx,
        );
        acc.push(res.data);
      }
      return acc;
    });

    return { success: true, count: resultados.length, data: resultados };
  }
}
