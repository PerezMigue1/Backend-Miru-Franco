import { IsIn, IsOptional, IsString } from 'class-validator';

const ESTADOS_RESOLUCION = ['aprobada', 'rechazada'] as const;

export class ResolverSolicitudPermisoDto {
  @IsIn(ESTADOS_RESOLUCION)
  estado: (typeof ESTADOS_RESOLUCION)[number];

  @IsOptional()
  @IsString()
  comentarioResolucion?: string;
}
