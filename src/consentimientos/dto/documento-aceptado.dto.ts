import { IsIn, IsString, Matches } from 'class-validator';
import { SLUGS_DOCUMENTO, SlugDocumento } from '../consentimientos.constants';
import { REGEX_HASH_DOCUMENTO, REGEX_VERSION_DOCUMENTO } from './registrar-consentimientos.dto';

/**
 * Documento legal que la persona aceptó, tal como está en el registro de la web (DOCUMENTOS_LEGALES:
 * { slug, version, hash }). Lo usan el registro con correo y el registro con Google.
 */
export class DocumentoAceptadoDto {
  @IsIn(SLUGS_DOCUMENTO, { message: `El documento debe ser uno de: ${SLUGS_DOCUMENTO.join(', ')}` })
  slug: SlugDocumento;

  @IsString({ message: 'La versión debe ser texto' })
  @Matches(REGEX_VERSION_DOCUMENTO, { message: 'La versión debe tener la forma X.Y' })
  version: string;

  @IsString({ message: 'El hash debe ser texto' })
  @Matches(REGEX_HASH_DOCUMENTO, { message: 'El hash debe ser SHA-256 en hexadecimal (64 caracteres)' })
  hash: string;
}
