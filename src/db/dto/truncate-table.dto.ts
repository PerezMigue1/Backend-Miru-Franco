import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { confirmacionTruncate } from '../db.constants';
import { BooleanoEstricto } from '../../common/utils/booleano-estricto.util';

const CONFIRMACION_REQUERIDA = `Confirmación requerida: escribe exactamente "${confirmacionTruncate('<tabla>')}" en el campo confirmacion`;

export class TruncateTableDto {
  @IsString()
  tabla: string;

  /**
   * Confirmación explícita: debe ser exactamente "TRUNCATE <tabla>" (el texto que la web pide
   * escribir en el modal). Obligatoria desde la validación (400 en español sin ella); el servicio
   * revisa además que coincida exactamente con la tabla.
   */
  @IsString({ message: CONFIRMACION_REQUERIDA })
  @Matches(/\S/, { message: CONFIRMACION_REQUERIDA })
  confirmacion: string;

  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'restartIdentity debe ser verdadero o falso' })
  restartIdentity?: boolean = true;

  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'cascade debe ser verdadero o falso' })
  cascade?: boolean = false;
}
