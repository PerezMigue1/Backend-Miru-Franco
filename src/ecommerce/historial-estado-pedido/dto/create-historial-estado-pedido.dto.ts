import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { EstadoPedido } from '@prisma/client';

export class CreateHistorialEstadoPedidoDto {
  @IsInt()
  @Min(1)
  pedidoId: number;

  @IsEnum(EstadoPedido)
  @IsOptional()
  estadoAnterior?: EstadoPedido | null;

  @IsEnum(EstadoPedido)
  estadoNuevo: EstadoPedido;

  @IsString()
  @IsOptional()
  origen?: string | null;

  @IsUUID()
  @IsOptional()
  usuarioId?: string | null;
}
