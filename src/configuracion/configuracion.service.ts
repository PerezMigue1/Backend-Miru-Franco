import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActualizarConfiguracionDto } from './dto/actualizar-configuracion.dto';

/** Fila fija: toda operación es contra id=1, nunca se crea una segunda fila. */
const ID_CONFIG = 1;
const DEFAULTS = {
  entradaLunesViernes: '09:00',
  salidaLunesViernes: '18:00',
  entradaSabado: '09:00',
  salidaSabado: '18:00',
  tarifaHoraExtra: 0,
};

@Injectable()
export class ConfiguracionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve la config; si la fila no existiera (ej. alguien la truncó a mano), la recrea con defaults. */
  async obtener() {
    const config = await this.prisma.configuracionSalon.upsert({
      where: { id: ID_CONFIG },
      update: {},
      create: { id: ID_CONFIG, ...DEFAULTS },
    });

    return { success: true, data: config };
  }

  async actualizar(dto: ActualizarConfiguracionDto) {
    const actual = await this.prisma.configuracionSalon.upsert({
      where: { id: ID_CONFIG },
      update: {},
      create: { id: ID_CONFIG, ...DEFAULTS },
    });

    const entradaLVFinal = dto.entradaLunesViernes ?? actual.entradaLunesViernes;
    const salidaLVFinal = dto.salidaLunesViernes ?? actual.salidaLunesViernes;
    if (salidaLVFinal <= entradaLVFinal) {
      throw new BadRequestException('La salida de lunes a viernes debe ser posterior a la entrada');
    }

    const entradaSabFinal = dto.entradaSabado ?? actual.entradaSabado;
    const salidaSabFinal = dto.salidaSabado ?? actual.salidaSabado;
    if (salidaSabFinal <= entradaSabFinal) {
      throw new BadRequestException('La salida del sábado debe ser posterior a la entrada');
    }

    // Domingo: "ambos o ninguno" — un domingo a medias (solo entrada o solo salida) es un
    // estado inválido que rompería el cálculo de horas extras de la Fase 3.
    const entradaDomFinal = dto.entradaDomingo !== undefined ? dto.entradaDomingo : actual.entradaDomingo;
    const salidaDomFinal = dto.salidaDomingo !== undefined ? dto.salidaDomingo : actual.salidaDomingo;
    if (Boolean(entradaDomFinal) !== Boolean(salidaDomFinal)) {
      throw new BadRequestException('El domingo debe tener entrada y salida, o dejarse ambos sin configurar');
    }
    if (entradaDomFinal && salidaDomFinal && salidaDomFinal <= entradaDomFinal) {
      throw new BadRequestException('La salida del domingo debe ser posterior a la entrada');
    }

    if (dto.margenGraciaMinutos !== undefined && dto.margenGraciaMinutos < 0) {
      throw new BadRequestException('El margen de gracia no puede ser negativo');
    }

    if (dto.tarifaHoraExtra !== undefined && dto.tarifaHoraExtra < 0) {
      throw new BadRequestException('La tarifa de hora extra no puede ser negativa');
    }

    const config = await this.prisma.configuracionSalon.update({
      where: { id: ID_CONFIG },
      data: {
        ...(dto.entradaLunesViernes !== undefined && { entradaLunesViernes: dto.entradaLunesViernes }),
        ...(dto.salidaLunesViernes !== undefined && { salidaLunesViernes: dto.salidaLunesViernes }),
        ...(dto.entradaSabado !== undefined && { entradaSabado: dto.entradaSabado }),
        ...(dto.salidaSabado !== undefined && { salidaSabado: dto.salidaSabado }),
        ...(dto.entradaDomingo !== undefined && { entradaDomingo: dto.entradaDomingo }),
        ...(dto.salidaDomingo !== undefined && { salidaDomingo: dto.salidaDomingo }),
        ...(dto.margenGraciaMinutos !== undefined && { margenGraciaMinutos: dto.margenGraciaMinutos }),
        ...(dto.tarifaHoraExtra !== undefined && { tarifaHoraExtra: dto.tarifaHoraExtra }),
      },
    });

    console.log('✅ Configuración del salón actualizada:', JSON.stringify({ id: config.id }));

    return { success: true, message: 'Configuración actualizada correctamente', data: config };
  }
}
