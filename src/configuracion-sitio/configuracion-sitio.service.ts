import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImagenesSubidasService } from '../subidas/imagenes-subidas.service';
import { anticiposDesde } from '../citas/anticipos/anticipos.util';
import { DEFINICIONES_REGLAS, establecerReglasNegocio, metodosSalonActivos, reglasNegocio, validarReglas, type ReglasNegocio, variablesDeReglas, reglasDesdeGuardado } from './reglas-negocio';
import { erroresHorario } from './horario.util';
import { textosPublicos } from '../textos-sitio/textos-sitio.util';

export const PERMISO_CONFIGURACION = 'configuracion:editar';
/** Operaciones > Horario y días inhábiles (el admin lo asigna en Permisos por rol; semilla: estilista). */
export const PERMISO_HORARIO = 'horario:editar';
/** Operaciones > Equipo en el sitio: foto, presentación y orden del equipo (semilla: estilista). */
export const PERMISO_EQUIPO_PUBLICO = 'equipo:publico';

/** Secciones públicas (GET /api/configuracion-publica) y las que solo ve el admin. */
const SECCIONES = ['salon', 'redes', 'horario', 'contenido_inicio', 'contenido_sobre_nosotros', 'contenido_contacto', 'reglas'] as const;
export type SeccionConfiguracion = (typeof SECCIONES)[number];

/**
 * Datos de configuración que también están escritos en los documentos legales (Términos, Aviso de privacidad,
 * Reembolsos, Cookies). Cambiarlos no cambia esos documentos: hace falta publicar una versión nueva.
 */
export const CAMPOS_EN_DOCUMENTOS_LEGALES: Record<string, string[]> = {
  salon: ['nombre', 'responsable', 'direccion', 'ciudad', 'codigoPostal', 'telefono', 'whatsapp', 'correoPrivacidad'],
  horario: ['dias'],
};

/** Claves que el admin puede asignar a cada rol (configuracion:editar queda solo para el admin, que tiene "*"). */
export const CATALOGO_PERMISOS: readonly { clave: string; descripcion: string; grupo: string }[] = [
  { clave: 'citas:escritura', descripcion: 'Agenda: crear y gestionar todas las citas', grupo: 'Citas' },
  { clave: 'citas:asignadas', descripcion: 'Ver las citas asignadas a sí misma', grupo: 'Citas' },
  { clave: 'seguimientos:lectura', descripcion: 'Ver seguimientos posteriores al servicio', grupo: 'Citas' },
  { clave: 'seguimientos:escritura', descripcion: 'Registrar seguimientos posteriores al servicio', grupo: 'Citas' },
  { clave: 'clientes:lectura', descripcion: 'Ver la ficha de las clientas', grupo: 'Clientas' },
  { clave: 'clientes:escritura', descripcion: 'Editar la ficha y anotar observaciones', grupo: 'Clientas' },
  { clave: 'ventas:escritura', descripcion: 'Punto de venta y cobro sin cita', grupo: 'Ventas y caja' },
  { clave: 'caja:escritura', descripcion: 'Caja: cobrar, cortes, anulaciones y salidas de efectivo', grupo: 'Ventas y caja' },
  { clave: 'caja:lectura', descripcion: 'Caja: consultar', grupo: 'Ventas y caja' },
  { clave: 'pedidos:entregar', descripcion: 'Pedidos en línea: preparar y entregar', grupo: 'Tienda' },
  { clave: 'devoluciones:gestionar', descripcion: 'Devoluciones y revocaciones de compra', grupo: 'Tienda' },
  { clave: 'reembolsos:gestionar', descripcion: 'Reembolsos pendientes: reintentar o marcar a mano', grupo: 'Tienda' },
  { clave: 'inventario:lectura', descripcion: 'Inventario: consultar', grupo: 'Inventario' },
  { clave: 'inventario:escritura', descripcion: 'Inventario: entradas, salidas y ajustes', grupo: 'Inventario' },
  { clave: 'servicios:lectura', descripcion: 'Servicios: consultar el catálogo', grupo: 'Servicios' },
  { clave: 'servicios:escritura', descripcion: 'Servicios: crear y editar', grupo: 'Servicios' },
  { clave: 'galeria:lectura', descripcion: 'Galería: ver todas las fotos', grupo: 'Galería' },
  { clave: 'galeria:gestionar', descripcion: 'Galería: subir, publicar, ordenar y eliminar fotos', grupo: 'Galería' },
  { clave: 'horario:editar', descripcion: 'Sitio: horario del salón y días inhábiles', grupo: 'Sitio' },
  { clave: 'equipo:publico', descripcion: 'Sitio: foto, presentación y orden del equipo', grupo: 'Sitio' },
  { clave: 'empleados:lectura', descripcion: 'Personal: consultar', grupo: 'Personal' },
  { clave: 'asistencia:gestionar', descripcion: 'Personal: asistencia', grupo: 'Personal' },
  { clave: 'solicitudes:gestionar', descripcion: 'Personal: permisos y vacaciones', grupo: 'Personal' },
  { clave: 'comisiones:configurar', descripcion: 'Comisiones: configurar', grupo: 'Personal' },
  { clave: 'comisiones:ver_propias', descripcion: 'Comisiones: ver las propias', grupo: 'Personal' },
];
/** Roles cuyos permisos se editan en la pantalla (admin queda en "*"; las clientas usan su portal fijo). */
export const ROLES_EDITABLES = ['estilista', 'empleado', 'becario'] as const;

const TIEMPO_CACHE_MS = 60_000;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEFONO = /^\+?[\d\s()-]{10,20}$/;
// La imagen que ya estaba (Cloudinary o una ruta del propio sitio, nunca "//otro.sitio") o una subida propia de
// sitio/ con el botón "Subir foto". Al guardar, una imagen distinta de la actual solo se acepta como subida propia.
const URL_IMAGEN = /^(https:\/\/res\.cloudinary\.com\/[^\s]+|\/(?![/\\])[\w./-]+|sitio\/(ilustrativas\/)?panel_[0-9a-f]{32})$/;
/** Campos de imagen de cada sección: se guardan solo si ya estaban o salieron de una subida propia. */
const CAMPOS_IMAGEN: Record<string, string[]> = { contenido_inicio: ['sobreNosotrosImagen'], contenido_sobre_nosotros: ['imagen'] };
const REDES: Record<string, { nombre: string; dominios: RegExp }> = {
  instagram: { nombre: 'Instagram', dominios: /^https:\/\/(www\.)?instagram\.com\/\S+$/i },
  facebook: { nombre: 'Facebook', dominios: /^https:\/\/(www\.|m\.)?facebook\.com\/\S+$/i },
  tiktok: { nombre: 'TikTok', dominios: /^https:\/\/(www\.)?tiktok\.com\/\S+$/i },
  twitter: { nombre: 'X (Twitter)', dominios: /^https:\/\/(www\.)?(x|twitter)\.com\/\S+$/i },
};

type Errores = string[];
type Campo = { etiqueta: string; max: number; obligatorio?: boolean; patron?: RegExp; mensajePatron?: string };

function texto(valor: unknown, c: Campo, errores: Errores): string {
  if (valor === undefined || valor === null) valor = '';
  if (typeof valor !== 'string') {
    errores.push(`El campo ${c.etiqueta} debe ser texto.`);
    return '';
  }
  const v = valor.trim();
  if (c.obligatorio && !v) errores.push(`Escribe el ${c.etiqueta}.`);
  else if (v.length > c.max) errores.push(`El ${c.etiqueta} tiene como máximo ${c.max} caracteres.`);
  else if (v && c.patron && !c.patron.test(v)) errores.push(c.mensajePatron ?? `El ${c.etiqueta} no es válido.`);
  return v;
}

function soloCampos(valor: unknown, permitidos: string[], errores: Errores): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    errores.push('El valor debe ser un objeto con los campos de la sección.');
    return {};
  }
  const extras = Object.keys(valor).filter((k) => !permitidos.includes(k));
  if (extras.length) errores.push(`Estos campos no se reconocen: ${extras.join(', ')}.`);
  return valor as Record<string, unknown>;
}

function listaTextos(valor: unknown, etiqueta: string, min: number, max: number, maxLargo: number, errores: Errores): string[] {
  if (!Array.isArray(valor)) {
    errores.push(`${etiqueta}: debe ser una lista.`);
    return [];
  }
  const lista = valor.map((v, i) => texto(v, { etiqueta: `${etiqueta.toLowerCase()} ${i + 1}`, max: maxLargo, obligatorio: true }, errores));
  if (lista.length < min || lista.length > max) errores.push(`${etiqueta}: entre ${min} y ${max}.`);
  return lista;
}

/** Valida y normaliza el valor de una sección. Lanza 400 con todos los errores en español. */
export function validarSeccion(clave: string, valor: unknown): unknown {
  const errores: Errores = [];
  let limpio: unknown;
  switch (clave) {
    case 'salon': {
      const v = soloCampos(valor, ['nombre', 'responsable', 'direccion', 'ciudad', 'codigoPostal', 'telefono', 'whatsapp', 'correoContacto', 'correoPrivacidad', 'mapaUrl', 'lema', 'descripcionSeo'], errores);
      limpio = {
        // El nombre va en el remitente de los correos: sin signos de dirección ni saltos de línea.
        nombre: texto(v.nombre, { etiqueta: 'nombre del salón', max: 120, obligatorio: true, patron: /^[^<>"@,;\\\x00-\x1f\x7f]+$/, mensajePatron: 'El nombre del salón no puede llevar < > " @ , ; \\ ni saltos de línea (va en el remitente de los correos).' }, errores),
        responsable: texto(v.responsable, { etiqueta: 'nombre de la responsable', max: 120, obligatorio: true }, errores),
        direccion: texto(v.direccion, { etiqueta: 'domicilio (calle, número y colonia)', max: 200, obligatorio: true }, errores),
        ciudad: texto(v.ciudad, { etiqueta: 'ciudad y estado', max: 120, obligatorio: true }, errores),
        codigoPostal: texto(v.codigoPostal, { etiqueta: 'código postal', max: 5, obligatorio: true, patron: /^\d{5}$/, mensajePatron: 'El código postal tiene 5 dígitos.' }, errores),
        telefono: texto(v.telefono, { etiqueta: 'teléfono', max: 20, obligatorio: true, patron: TELEFONO, mensajePatron: 'El teléfono debe tener al menos 10 dígitos (puede llevar +52).' }, errores),
        whatsapp: texto(v.whatsapp, { etiqueta: 'WhatsApp', max: 20, patron: TELEFONO, mensajePatron: 'El WhatsApp debe tener al menos 10 dígitos (puede llevar +52).' }, errores),
        correoContacto: texto(v.correoContacto, { etiqueta: 'correo de contacto', max: 120, obligatorio: true, patron: CORREO, mensajePatron: 'El correo de contacto no es válido.' }, errores),
        correoPrivacidad: texto(v.correoPrivacidad, { etiqueta: 'correo de privacidad y quejas', max: 120, obligatorio: true, patron: CORREO, mensajePatron: 'El correo de privacidad y quejas no es válido.' }, errores),
        mapaUrl: texto(v.mapaUrl, { etiqueta: 'enlace del mapa', max: 500, patron: /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+)\S*$/i, mensajePatron: 'El enlace del mapa debe ser de Google Maps y empezar con https://.' }, errores),
        lema: texto(v.lema, { etiqueta: 'lema del pie de página', max: 300 }, errores),
        descripcionSeo: texto(v.descripcionSeo, { etiqueta: 'descripción para buscadores', max: 300 }, errores),
      };
      break;
    }
    case 'redes': {
      const v = soloCampos(valor, Object.keys(REDES), errores);
      limpio = Object.fromEntries(
        Object.entries(REDES).map(([k, r]) => [k, texto(v[k], { etiqueta: `enlace de ${r.nombre}`, max: 300, patron: r.dominios, mensajePatron: `El enlace de ${r.nombre} debe ser de ${r.nombre} y empezar con https://.` }, errores)]),
      );
      break;
    }
    case 'horario': {
      const v = soloCampos(valor, ['dias'], errores);
      errores.push(...erroresHorario(v.dias));
      limpio = { dias: Array.isArray(v.dias) ? v.dias.map((d: any) => ({ dia: d?.dia, cerrado: Boolean(d?.cerrado), abre: d?.cerrado ? '' : d?.abre, cierra: d?.cerrado ? '' : d?.cierra })) : [] };
      break;
    }
    case 'contenido_inicio': {
      const v = soloCampos(valor, ['heroTexto', 'heroDestacado', 'productosDescripcion', 'serviciosDescripcion', 'trabajoDescripcion', 'sobreNosotrosParrafos', 'sobreNosotrosImagen', 'cierreTitulo', 'cierreTexto'], errores);
      limpio = {
        heroTexto: texto(v.heroTexto, { etiqueta: 'texto de la portada', max: 300, obligatorio: true }, errores),
        heroDestacado: texto(v.heroDestacado, { etiqueta: 'frase grande de la portada', max: 40, obligatorio: true }, errores),
        productosDescripcion: texto(v.productosDescripcion, { etiqueta: 'texto de productos', max: 200 }, errores),
        serviciosDescripcion: texto(v.serviciosDescripcion, { etiqueta: 'texto de servicios', max: 200 }, errores),
        trabajoDescripcion: texto(v.trabajoDescripcion, { etiqueta: 'texto de la galería', max: 200 }, errores),
        sobreNosotrosParrafos: listaTextos(v.sobreNosotrosParrafos, 'Párrafos de "Sobre nosotros"', 1, 4, 600, errores),
        sobreNosotrosImagen: texto(v.sobreNosotrosImagen, { etiqueta: 'imagen de "Sobre nosotros"', max: 500, patron: URL_IMAGEN, mensajePatron: 'Sube la imagen con el botón "Subir foto".' }, errores),
        cierreTitulo: texto(v.cierreTitulo, { etiqueta: 'título del cierre', max: 80, obligatorio: true }, errores),
        cierreTexto: texto(v.cierreTexto, { etiqueta: 'texto del cierre', max: 200 }, errores),
      };
      break;
    }
    case 'contenido_sobre_nosotros': {
      const v = soloCampos(valor, ['titulo', 'parrafos', 'imagen', 'valores'], errores);
      const valores = Array.isArray(v.valores) ? v.valores : [];
      if (!Array.isArray(v.valores) || valores.length > 6) errores.push('Valores: una lista de hasta 6.');
      limpio = {
        titulo: texto(v.titulo, { etiqueta: 'título', max: 80, obligatorio: true }, errores),
        parrafos: listaTextos(v.parrafos, 'Párrafos de la historia', 1, 5, 800, errores),
        imagen: texto(v.imagen, { etiqueta: 'imagen', max: 500, patron: URL_IMAGEN, mensajePatron: 'Sube la imagen con el botón "Subir foto".' }, errores),
        valores: valores.slice(0, 6).map((x: any, i: number) => ({
          titulo: texto(x?.titulo, { etiqueta: `título del valor ${i + 1}`, max: 40, obligatorio: true }, errores),
          descripcion: texto(x?.descripcion, { etiqueta: `descripción del valor ${i + 1}`, max: 200, obligatorio: true }, errores),
        })),
      };
      break;
    }
    case 'contenido_contacto': {
      const v = soloCampos(valor, ['introduccion', 'agendaTexto'], errores);
      limpio = {
        introduccion: texto(v.introduccion, { etiqueta: 'introducción de contacto', max: 300, obligatorio: true }, errores),
        agendaTexto: texto(v.agendaTexto, { etiqueta: 'texto de "Agenda en línea"', max: 300, obligatorio: true }, errores),
      };
      break;
    }
    case 'reglas': {
      // Reglas de negocio completas (reglas-negocio.ts): rangos, mensajes en español y pisos de ley. Lo que no viene
      // se completa con las reglas vigentes, así un guardado parcial no regresa nada a su valor por omisión.
      const r = validarReglas(valor, reglasNegocio());
      errores.push(...r.errores);
      limpio = r.limpio;
      break;
    }
    default:
      throw new BadRequestException(`La sección "${clave}" no existe.`);
  }
  if (errores.length) throw new BadRequestException({ message: errores, error: 'Datos de configuración inválidos' });
  return limpio;
}

function cambiaronCamposLegales(clave: string, antes: unknown, despues: unknown): boolean {
  const campos = CAMPOS_EN_DOCUMENTOS_LEGALES[clave];
  if (!campos) return false;
  const a = (antes ?? {}) as Record<string, unknown>;
  const d = (despues ?? {}) as Record<string, unknown>;
  return campos.some((c) => JSON.stringify(a[c]) !== JSON.stringify(d[c]));
}

/**
 * Configuración del sitio (Admin > Configuración del sitio): una fila por sección y un historial de solo inserción
 * con cada cambio (también los permisos por rol). La lectura pública se guarda en caché un minuto y se borra al
 * guardar, así el sitio refleja el cambio sin deploy.
 */
@Injectable()
export class ConfiguracionSitioService implements OnModuleInit {
  private readonly logger = new Logger(ConfiguracionSitioService.name);
  private cache: { valor: Record<string, unknown>; vence: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly subidas?: ImagenesSubidasService,
  ) {}

  /**
   * Imágenes de la sección: la que ya estaba se conserva igual y una nueva solo como subida propia de sitio/ (se cambia
   * por la URL que arma el servidor). Una URL escrita a mano es 400.
   */
  private async resolverImagenesSeccion(clave: string, limpio: Record<string, unknown>, usuarioId: string): Promise<Record<string, unknown>> {
    const campos = CAMPOS_IMAGEN[clave];
    if (!campos) return limpio;
    const guardada = (await this.prisma.configuracionSitio.findUnique({ where: { clave } }))?.valor as Record<string, unknown> | null | undefined;
    const resultado = { ...limpio };
    for (const campo of campos) {
      const valor = typeof limpio[campo] === 'string' ? (limpio[campo] as string) : '';
      const actual = typeof guardada?.[campo] === 'string' ? (guardada[campo] as string) : '';
      if (!valor || valor === actual) continue;
      if (!this.subidas) throw new ServiceUnavailableException('La subida de imágenes no está disponible por ahora.');
      resultado[campo] = (await this.subidas.resolverImagen(usuarioId, 'sitio', valor, actual || null)) ?? '';
    }
    return resultado;
  }

  async onModuleInit(): Promise<void> {
    await this.refrescarReglas();
  }

  /**
   * Las reglas de negocio guardadas aquí mandan en todo el backend (las variables de entorno quedan de respaldo). Se
   * cargan al arrancar, cada minuto y al guardar. Si la lectura falla se conservan las vigentes.
   */
  @Interval(TIEMPO_CACHE_MS)
  async refrescarReglas(): Promise<void> {
    try {
      const reglas = await this.prisma.configuracionSitio.findUnique({ where: { clave: 'reglas' } });
      establecerReglasNegocio(reglas?.valor ?? null);
    } catch (e) {
      this.logger.warn(`No se pudieron leer las reglas de negocio de la configuración (${e instanceof Error ? e.message : e})`);
    }
  }

  /**
   * Reglas que puede ver cualquiera (web y app): plazos, políticas y métodos de pago activos. Los datos de transferencia
   * solo si la transferencia está activa y completa. Nada de datos personales ni secretos.
   */
  private reglasPublicas(r: ReglasNegocio) {
    const t = r.pagos.transferencia;
    return {
      citas: r.citas,
      tienda: { ...r.tienda, apartadosDesde: undefined },
      revocacion: r.revocacion,
      garantia: r.garantia,
      facturacion: r.facturacion,
      arco: { diasHabilesRespuesta: r.arco.diasHabilesRespuesta, diasHabilesEfectividad: r.arco.diasHabilesEfectividad, diasAvisoVencePronto: r.arco.diasAvisoVencePronto },
      pagos: {
        mercadoPagoTienda: r.pagos.mercadoPagoTienda,
        mercadoPagoAnticipos: r.pagos.mercadoPagoAnticipos,
        metodosSalon: metodosSalonActivos(r),
        transferencia: r.pagos.salon.transferencia && t.banco && t.titular && t.clabe ? { banco: t.banco, titular: t.titular, clabe: t.clabe } : null,
      },
      diasInhabiles: r.diasInhabiles,
      // Para los textos del sitio: {plazoAnticipoHoras}, {diasResguardo}... ya con el valor vigente.
      variables: variablesDeReglas(r),
    };
  }

  private async filas(): Promise<Record<string, unknown>> {
    const filas = await this.prisma.configuracionSitio.findMany();
    return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  }

  async publica(ahora = Date.now()) {
    if (this.cache && this.cache.vence > ahora) return this.cache.valor;
    const f = await this.filas();
    const valor = {
      salon: f.salon ?? null,
      redes: f.redes ?? null,
      horario: f.horario ?? null,
      contenido: {
        inicio: f.contenido_inicio ?? null,
        sobreNosotros: f.contenido_sobre_nosotros ?? null,
        contacto: f.contenido_contacto ?? null,
      },
      // Sin fecha de anticipos (ni aquí ni en la variable), el sitio no promete anticipo en ningún lado.
      anticiposActivos: anticiposDesde() !== null,
      reglas: this.reglasPublicas(reglasNegocio()),
      // Textos del sitio (Admin > Textos del sitio): solo los públicos, con las variables de reglas ya llenas.
      textos: textosPublicos(variablesDeReglas(reglasNegocio())),
    };
    this.cache = { valor, vence: ahora + TIEMPO_CACHE_MS };
    return valor;
  }

  /** Al guardar un texto del sitio (TextosSitioService): la próxima lectura pública ya lo trae. */
  invalidarCachePublica(): void {
    this.cache = null;
  }

  async obtenerTodo() {
    const filas = await this.prisma.configuracionSitio.findMany({ include: { actualizadoPor: { select: { nombre: true } } } } as Prisma.ConfiguracionSitioFindManyArgs);
    return {
      data: Object.fromEntries(
        filas.map((f: any) => [f.clave, { valor: f.valor, actualizadoEn: f.actualizadoEn, actualizadoPor: f.actualizadoPor?.nombre ?? null }]),
      ),
      camposEnDocumentosLegales: CAMPOS_EN_DOCUMENTOS_LEGALES,
      anticiposDesdeRespaldo: (process.env.ANTICIPOS_DESDE ?? '').trim() || null,
      apartadosDesdeRespaldo: (process.env.APARTADOS_DESDE ?? '').trim() || null,
      definicionesReglas: DEFINICIONES_REGLAS,
      reglasVigentes: reglasNegocio(),
    };
  }

  /**
   * `versionBase`: el actualizadoEn que tenía la pantalla al abrir la sección. Si otra persona guardó después, 409 en
   * vez de pisar su cambio sin aviso. `valor` como función: se arma dentro del candado con lo guardado en la base
   * (Operaciones cambia solo los días inhábiles sin pisar las demás reglas).
   */
  async guardar(clave: string, valor: unknown, usuarioId: string, opciones: { versionBase?: string | null } = {}) {
    if (!(SECCIONES as readonly string[]).includes(clave)) throw new BadRequestException(`La sección "${clave}" no existe.`);
    const armar = typeof valor === 'function' ? (valor as (guardado: unknown) => unknown) : null;
    const previo = armar ? null : ((await this.resolverImagenesSeccion(clave, validarSeccion(clave, valor) as Record<string, unknown>, usuarioId)) as Prisma.InputJsonValue);
    let limpio = previo as Prisma.InputJsonValue;
    const resultado = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`configuracion-sitio:${clave}`}))`;
      const actual = await tx.configuracionSitio.findUnique({ where: { clave } });
      if (opciones.versionBase && actual && new Date(actual.actualizadoEn).toISOString() !== new Date(opciones.versionBase).toISOString()) {
        throw new ConflictException('Otra persona guardó cambios en esta sección mientras la editabas. Recarga la página para ver lo último y vuelve a hacer tus cambios.');
      }
      if (armar) limpio = validarSeccion(clave, armar(actual?.valor ?? null)) as Prisma.InputJsonValue;
      const guardada = await tx.configuracionSitio.upsert({
        where: { clave },
        create: { clave, tipo: clave, valor: limpio, actualizadoPorId: usuarioId },
        update: { valor: limpio, actualizadoPorId: usuarioId },
      });
      await tx.historialConfiguracionSitio.create({
        data: { clave, valorAnterior: (actual?.valor ?? Prisma.DbNull) as Prisma.InputJsonValue, valorNuevo: limpio, actualizadoPorId: usuarioId },
      });
      return { afectaDocumentosLegales: cambiaronCamposLegales(clave, actual?.valor, limpio), actualizadoEn: guardada.actualizadoEn };
    });
    this.cache = null;
    if (clave === 'reglas') establecerReglasNegocio(limpio);
    return { success: true, clave, valor: limpio, ...resultado };
  }

  /** Operaciones > Horario y días inhábiles: lo que se edita ahí, con quién lo cambió por última vez. */
  async operacion() {
    const filas = await this.prisma.configuracionSitio.findMany({
      where: { clave: { in: ['horario', 'reglas'] } },
      select: { clave: true, valor: true, actualizadoEn: true, actualizadoPor: { select: { nombre: true } } },
    });
    const horario = filas.find((f) => f.clave === 'horario');
    const reglas = filas.find((f) => f.clave === 'reglas');
    return {
      horario: horario ? { valor: horario.valor, actualizadoEn: horario.actualizadoEn, actualizadoPor: horario.actualizadoPor?.nombre ?? null } : null,
      diasInhabiles: reglasNegocio().diasInhabiles,
      definicionDiasInhabiles: DEFINICIONES_REGLAS.find((d) => d.ruta === 'diasInhabiles') ?? null,
      diasInhabilesActualizado: reglas ? { actualizadoEn: reglas.actualizadoEn, actualizadoPor: reglas.actualizadoPor?.nombre ?? null } : null,
    };
  }

  /** Solo los días inhábiles: el resto de las reglas queda igual (se valida y se guarda con historial como siempre). */
  guardarDiasInhabiles(lista: unknown, usuarioId: string, versionBase?: string | null) {
    // Se arma dentro del candado con las reglas guardadas en la base (no con la copia en memoria).
    return this.guardar('reglas', (guardado: unknown) => ({ ...reglasDesdeGuardado(guardado), diasInhabiles: lista }), usuarioId, { versionBase });
  }

  async historial(clave?: string) {
    const filas = await this.prisma.historialConfiguracionSitio.findMany({
      where: clave ? { clave } : undefined,
      orderBy: { id: 'desc' },
      take: 100,
      include: { actualizadoPor: { select: { nombre: true } } },
    } as Prisma.HistorialConfiguracionSitioFindManyArgs);
    return {
      data: filas.map((h: any) => ({
        id: h.id,
        clave: h.clave,
        valorAnterior: h.valorAnterior,
        valorNuevo: h.valorNuevo,
        creadoEn: h.creadoEn,
        actualizadoPor: h.actualizadoPor?.nombre ?? null,
        afectaDocumentosLegales: cambiaronCamposLegales(h.clave, h.valorAnterior, h.valorNuevo),
      })),
    };
  }

  async permisos() {
    const filas = await this.prisma.permisoRol.findMany();
    const porRol = Object.fromEntries(filas.map((f) => [f.rol, f.claves]));
    return {
      catalogo: CATALOGO_PERMISOS,
      roles: ['admin', ...ROLES_EDITABLES].map((rol) => ({
        rol,
        editable: rol !== 'admin',
        claves: rol === 'admin' ? ['*'] : (porRol[rol] ?? []),
      })),
    };
  }

  async guardarPermisos(rol: string, claves: unknown, usuarioId: string) {
    if (rol === 'admin') throw new ForbiddenException('El admin siempre tiene todos los permisos ("*"): no se edita.');
    if (!(ROLES_EDITABLES as readonly string[]).includes(rol)) throw new BadRequestException(`El rol "${rol}" no se edita aquí.`);
    if (!Array.isArray(claves) || claves.some((c) => typeof c !== 'string')) throw new BadRequestException('Los permisos deben ser una lista de claves.');
    const catalogo = new Set(CATALOGO_PERMISOS.map((c) => c.clave));
    const desconocidas = (claves as string[]).filter((c) => !catalogo.has(c));
    if (desconocidas.length) throw new BadRequestException(`Estas claves no existen: ${desconocidas.join(', ')}.`);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`permisos-rol:${rol}`}))`;
      const actual = await tx.permisoRol.findUnique({ where: { rol } });
      const anteriores = actual?.claves ?? [];
      // Las claves que no están en el catálogo (otras pantallas o el portal) se conservan tal cual.
      const nuevas = [...new Set([...anteriores.filter((c) => !catalogo.has(c)), ...(claves as string[])])];
      await tx.permisoRol.upsert({ where: { rol }, create: { rol, claves: nuevas }, update: { claves: nuevas } });
      await tx.historialConfiguracionSitio.create({
        data: { clave: `permisos:${rol}`, valorAnterior: anteriores, valorNuevo: nuevas, actualizadoPorId: usuarioId },
      });
      return { success: true, rol, claves: nuevas };
    });
  }
}
