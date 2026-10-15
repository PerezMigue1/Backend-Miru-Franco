import { Type } from 'class-transformer';
import { ArrayMaxSize, Equals, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { DocumentoAceptadoDto } from '../../consentimientos/dto/documento-aceptado.dto';
import { BooleanoEstricto } from '../../common/utils/booleano-estricto.util';

/** POST /auth/google/completar: alta de una cuenta nueva de Google en la web, después de aceptar. */
export class CompletarRegistroGoogleDto {
  /** Token de /auth/completar-registro?token=... (15 minutos, propósito registro_google). */
  @IsString({ message: 'El token debe ser texto' })
  @IsNotEmpty({ message: 'Falta el token del registro con Google' })
  @MaxLength(4096, { message: 'El token no es válido' })
  token: string;

  // Casillas de consentimiento: booleano real (BooleanoEstricto); "false" o "no" en texto dan 400.
  @BooleanoEstricto()
  @IsBoolean({ message: 'Debes aceptar los términos y condiciones' })
  @Equals(true, { message: 'Debes aceptar los términos y condiciones' })
  aceptaTerminos: boolean;

  @BooleanoEstricto()
  @IsBoolean({ message: 'Debes aceptar el aviso de privacidad' })
  @Equals(true, { message: 'Debes aceptar el aviso de privacidad' })
  aceptaAvisoPrivacidad: boolean;

  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'El campo recibePromociones debe ser verdadero o falso' })
  recibePromociones?: boolean;

  /** Versiones aceptadas (DOCUMENTOS_LEGALES de la web); las obligatorias que falten se toman de la vigente. */
  @IsOptional()
  @IsArray({ message: 'documentos debe ser una lista' })
  @ArrayMaxSize(5, { message: 'Envía como máximo 5 documentos' })
  @ValidateNested({ each: true })
  @Type(() => DocumentoAceptadoDto)
  documentos?: DocumentoAceptadoDto[];
}
