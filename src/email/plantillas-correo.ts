import { escaparHtml } from '../common/utils/security.util';
import { textoSitio } from '../textos-sitio/textos-sitio.util';

/**
 * Plantillas de los correos. El asunto y los textos salen del catálogo de Textos del sitio (Admin > Textos del sitio),
 * con sus variables; el formato y el diseño HTML se quedan aquí. El nombre del salón va como el marcador {{salon}}:
 * EmailService lo cambia por el de Configuración del sitio (escapado en el HTML) al enviar.
 *
 * Todo lo que viene del catálogo o de los datos se escapa: los textos son texto plano (una línea en blanco separa
 * párrafos y un salto de línea simple es un <br>).
 */
export const MARCADOR_SALON = '{{salon}}';

export interface Correo {
  asunto: string;
  html: string;
}

type Contexto = Record<string, string | number | null | undefined>;

/** Texto del catálogo con el nombre del salón como marcador. */
export function textoCorreo(clave: string, contexto: Contexto = {}): string {
  return textoSitio(clave, { nombreSalon: MARCADOR_SALON, ...contexto });
}

/** Párrafos escapados con el estilo dado; `enlaces` cambia [[nombre]] por un enlace ya armado aquí. */
export function parrafos(texto: string, estilo = '', enlaces: Record<string, string> = {}): string {
  const atributo = estilo ? ` style="${estilo}"` : '';
  return texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      let html = escaparHtml(p).replace(/\r?\n/g, '<br>');
      for (const [nombre, a] of Object.entries(enlaces)) html = html.split(`[[${nombre}]]`).join(a);
      return `<p${atributo}>${html}</p>`;
    })
    .join('\n            ');
}

const linea = (clave: string, contexto: Contexto = {}) => escaparHtml(textoCorreo(clave, contexto));
const CAJA_CODIGO = (codigo: string) => `
            <div style="background-color: #f2f1ed; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
              <h1 style="color: #161616; font-size: 32px; letter-spacing: 8px; margin: 0;">${escaparHtml(codigo)}</h1>
            </div>`;
const NOTA = 'color: #666; font-size: 12px;';

/** Correos con código (activación, cambio de contraseña, cambio de correo). */
function correoConCodigo(base: string, codigo: string, contexto: Contexto = {}): Correo {
  return {
    asunto: textoCorreo(`${base}.asunto`, contexto),
    html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #710014;">${linea(`${base}.titulo`, contexto)}</h2>
            ${parrafos(textoCorreo(`${base}.cuerpo`, contexto))}${CAJA_CODIGO(codigo)}
            ${parrafos(textoCorreo(`${base}.nota`, contexto), NOTA)}
          </div>
        `,
  };
}

export const correoActivacion = (codigo: string) => correoConCodigo('correos.activacion', codigo);
export const correoCodigoPassword = (codigo: string, minutos: number) => correoConCodigo('correos.codigoPassword', codigo, { minutos });
export const correoCodigoCorreo = (codigo: string, minutos: number) => correoConCodigo('correos.codigoCorreo', codigo, { minutos });
export const correoCodigoCorreoActual = (codigo: string, correoNuevo: string, minutos: number) =>
  correoConCodigo('correos.correoActual', codigo, { minutos, correoNuevo });

export function correoRecuperarPassword(enlace: string, minutos: number): Correo {
  const importante = textoCorreo('correos.recuperar.importante', { minutos })
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<li>${escaparHtml(l)}</li>`)
    .join('\n                ');
  return {
    asunto: textoCorreo('correos.recuperar.asunto'),
    html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h2 style="color: #710014; margin: 0;">${MARCADOR_SALON}</h2>
            </div>

            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #161616; margin-top: 0;">${linea('correos.recuperar.titulo')}</h3>
              ${parrafos(textoCorreo('correos.recuperar.cuerpo'), 'color: #495057; line-height: 1.6;')}
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${escaparHtml(enlace)}"
                 style="display: inline-block; background-color: #710014; color: white;
                        padding: 14px 28px; text-decoration: none; border-radius: 6px;
                        font-weight: bold; font-size: 16px;">
                ${linea('correos.recuperar.boton')}
              </a>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; border-left: 4px solid #ffc107; margin: 20px 0;">
              <p style="color: #856404; margin: 0; font-size: 14px;">
                <strong>Importante:</strong>
              </p>
              <ul style="color: #856404; margin: 10px 0 0 0; padding-left: 20px; font-size: 14px;">
                ${importante}
              </ul>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
              <p style="color: #6c757d; font-size: 12px; margin: 0;">
                ${linea('correos.recuperar.enlaceAlterno')}
              </p>
              <p style="color: #6c757d; font-size: 12px; word-break: break-all; margin: 5px 0 0 0;">
                ${escaparHtml(enlace)}
              </p>
            </div>

            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6;">
              <p style="color: #6c757d; font-size: 12px; margin: 0;">
                ${linea('correos.pieAutomatico')}
              </p>
            </div>
          </div>
        `,
  };
}

/** Avisos de la cuenta (contraseña, correo o pregunta de seguridad cambiados): título, explicación y nota. */
function correoAviso(base: string, contexto: Contexto, enlaces: Record<string, string> = {}): Correo {
  return {
    asunto: textoCorreo(`${base}.asunto`, contexto),
    html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #710014;">${linea(`${base}.titulo`, contexto)}</h2>
            ${parrafos(textoCorreo(`${base}.cuerpo`, contexto))}
            ${parrafos(textoCorreo(`${base}.nota`, contexto), 'color: #666;', enlaces)}
          </div>
        `,
  };
}

export function correoPasswordCambiada(fechaHora: string, enlaceRecuperar: string): Correo {
  const enlace = `<a href="${escaparHtml(enlaceRecuperar)}" style="color: #710014;">${linea('correos.passwordCambiada.textoEnlace')}</a>`;
  return correoAviso('correos.passwordCambiada', { fechaHora, enlaceRecuperar: '[[enlaceRecuperar]]' }, { enlaceRecuperar: enlace });
}
export const correoCorreoCambiado = (fechaHora: string) => correoAviso('correos.correoCambiado', { fechaHora });
export const correoPreguntaCambiada = (fechaHora: string) => correoAviso('correos.preguntaCambiada', { fechaHora });

const TIPOS_ARCO: Record<string, string> = {
  acceso: 'Acceso a tus datos',
  rectificacion: 'Rectificación',
  cancelacion: 'Cancelación',
  oposicion: 'Oposición',
  revocacion: 'Revocación del consentimiento',
};
const ESTADOS_ARCO: Record<string, string> = { respondida: 'Respondida', atendida: 'Atendida', rechazada: 'Rechazada', en_proceso: 'En proceso' };

export function correoRespuestaArco(datos: { folio: string; tipo: string; estado: string; respuesta: string }): Correo {
  const respuesta = escaparHtml(datos.respuesta).replace(/\r?\n/g, '<br>');
  const contexto = { folio: datos.folio };
  return {
    asunto: textoCorreo('correos.arcoRespuesta.asunto', contexto),
    html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #710014;">${linea('correos.arcoRespuesta.titulo', contexto)}</h2>
            <p><strong>Folio:</strong> ${escaparHtml(datos.folio)}</p>
            <p><strong>Tipo:</strong> ${escaparHtml(TIPOS_ARCO[datos.tipo] ?? datos.tipo)}</p>
            <p><strong>Estado:</strong> ${escaparHtml(ESTADOS_ARCO[datos.estado] ?? datos.estado)}</p>
            <div style="background-color: #f2f1ed; padding: 16px; margin: 20px 0; border-radius: 8px;">${respuesta}</div>
            ${parrafos(textoCorreo('correos.arcoRespuesta.nota', contexto), NOTA)}
          </div>
        `,
  };
}

export function correoCancelacionCuentaArco(datos: { folio: string; fecha: Date }): Correo {
  const fecha = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' }).format(datos.fecha);
  const contexto = { folio: datos.folio, fecha };
  return {
    asunto: textoCorreo('correos.arcoCancelacion.asunto', contexto),
    html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #710014;">${linea('correos.arcoCancelacion.titulo', contexto)}</h2>
            ${parrafos(textoCorreo('correos.arcoCancelacion.cuerpo', contexto))}
            ${parrafos(textoCorreo('correos.arcoCancelacion.nota', contexto), NOTA)}
          </div>
        `,
  };
}

/** Correo de un aviso interno (canal email del motor de notificaciones): título y mensaje del aviso. */
export function htmlAviso(titulo: string, mensaje: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h2 style="color: #710014; margin: 0;">${MARCADOR_SALON}</h2>
      </div>
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h3 style="color: #161616; margin-top: 0;">${escaparHtml(titulo)}</h3>
        <p style="color: #495057; line-height: 1.6; white-space: pre-line;">${escaparHtml(mensaje)}</p>
      </div>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #dee2e6;">
        <p style="color: #6c757d; font-size: 12px; margin: 0;">
          ${linea('correos.pieAutomatico')}
        </p>
      </div>
    </div>
  `;
}
