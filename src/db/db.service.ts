import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { Decimal } from '@prisma/client/runtime/library';
import {
  TABLAS_PERMITIDAS,
  MAX_FILE_SIZE_BYTES,
  type TablaPermitida,
} from './db.constants';
import { generateMermaidFromSchema } from './schema-to-mermaid';

const SALT_ROUNDS = 10;

/** Resultado de importación de una fila */
export interface ImportError {
  fila: number;
  mensaje: string;
}

export interface ImportResult {
  success: boolean;
  importados: number;
  fallidos: number;
  errores: ImportError[];
}

/** Normaliza clave camelCase o snake_case a camelCase para Prisma */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Parsea CSV simple (cabeceras + filas). Maneja campos entre comillas. */
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if ((c === ',' && !inQuotes) || c === '\n') {
        result.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]).map((h) => toCamelCase(h.replace(/^"|"$/g, '').trim()));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      let v = values[idx] ?? '';
      obj[h] = v.replace(/^"|"$/g, '').trim();
    });
    rows.push(obj);
  }
  return rows;
}

/** Parsea JSON esperando array de objetos */
function parseJSON(content: string): Record<string, any>[] {
  const data = JSON.parse(content);
  if (!Array.isArray(data)) {
    throw new BadRequestException('El JSON debe ser un array de objetos');
  }
  return data.map((row) => {
    const normalized: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      normalized[toCamelCase(String(k))] = v;
    }
    return normalized;
  });
}

@Injectable()
export class DbService {
  constructor(private readonly prisma: PrismaService) {}

  async importar(
    tabla: string,
    archivo: { buffer: Buffer; originalname?: string; size: number },
    formato?: string,
  ): Promise<ImportResult> {
    if (!TABLAS_PERMITIDAS.includes(tabla as TablaPermitida)) {
      throw new BadRequestException(`Tabla no permitida: ${tabla}`);
    }

    if (archivo.size > MAX_FILE_SIZE_BYTES) {
      throw new PayloadTooLargeException(
        `El archivo supera el límite de ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
      );
    }

    const ext = archivo.originalname?.toLowerCase().split('.').pop() ?? '';
    const fmt = formato?.toLowerCase() ?? (ext === 'csv' ? 'csv' : ext === 'json' ? 'json' : null);
    if (fmt !== 'csv' && fmt !== 'json') {
      throw new BadRequestException('Formato no válido. Use CSV o JSON.');
    }

    const content = archivo.buffer.toString('utf-8');
    if (!content.trim()) {
      throw new BadRequestException('El archivo está vacío');
    }

    let registros: Record<string, any>[];
    try {
      registros = fmt === 'csv' ? parseCSV(content) : parseJSON(content);
    } catch (e: any) {
      throw new BadRequestException(`Error al parsear el archivo: ${e.message}`);
    }

    if (registros.length === 0) {
      throw new BadRequestException('No hay registros para importar');
    }

    const errores: ImportError[] = [];
    let importados = 0;

    for (let i = 0; i < registros.length; i++) {
      const fila = i + 2; // 1 = cabecera en CSV
      try {
        await this.insertarRegistro(tabla as TablaPermitida, registros[i]);
        importados++;
      } catch (e: any) {
        errores.push({ fila, mensaje: e.message || String(e) });
      }
    }

    return {
      success: true,
      importados,
      fallidos: errores.length,
      errores,
    };
  }

  private async insertarRegistro(
    tabla: TablaPermitida,
    row: Record<string, any>,
  ): Promise<void> {
    if (tabla === 'productos') {
      await this.importarProducto(row);
    } else if (tabla === 'usuarios') {
      await this.importarUsuario(row);
    } else if (tabla === 'servicios') {
      await this.importarServicio(row);
    } else {
      throw new Error(`Tabla no implementada: ${tabla}`);
    }
  }

  private async importarProducto(row: Record<string, any>): Promise<void> {
    const nombre = String(row.nombre ?? row.Nombre ?? '').trim();
    const marca = String(row.marca ?? row.Marca ?? '').trim();
    if (!nombre || !marca) {
      throw new Error('nombre y marca son requeridos');
    }

    const imagenes = this.toArray(row.imagenes ?? row.imagen ?? []);
    const caracteristicas = this.toArray(row.caracteristicas ?? []);

    await this.prisma.producto.create({
      data: {
        nombre,
        marca,
        descripcion: this.optStr(row.descripcion),
        descripcionLarga: this.optStr(row.descripcionLarga),
        imagenes,
        descuento: this.optInt(row.descuento),
        categoria: this.optStr(row.categoria),
        nuevo: this.toBool(row.nuevo, false),
        crueltyFree: this.toBool(row.crueltyFree, false),
        caracteristicas,
        ingredientes: this.optStr(row.ingredientes),
        modoUso: this.optStr(row.modoUso),
        resultado: this.optStr(row.resultado),
      },
    });
  }

  private async importarUsuario(row: Record<string, any>): Promise<void> {
    const nombre = String(row.nombre ?? row.Nombre ?? '').trim();
    const email = String(row.email ?? row.Email ?? '').trim().toLowerCase();
    const password = row.password;
    if (!nombre || !email) {
      throw new Error('nombre y email son requeridos');
    }

    const existing = await this.prisma.usuario.findUnique({ where: { email } });
    if (existing) {
      throw new Error('El email ya está registrado');
    }

    let hashedPassword: string | null = null;
    if (password && typeof password === 'string' && password.length >= 8) {
      hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    } else if (password) {
      throw new Error('La contraseña debe tener al menos 8 caracteres');
    }

    await this.prisma.usuario.create({
      data: {
        nombre,
        email,
        telefono: this.optStr(row.telefono) ?? '',
        password: hashedPassword,
        fechaNacimiento: this.optDate(row.fechaNacimiento),
        aceptaAvisoPrivacidad: this.toBool(row.aceptaAvisoPrivacidad, false),
        recibePromociones: this.toBool(row.recibePromociones, false),
        confirmado: this.toBool(row.confirmado, false),
        activo: this.toBool(row.activo, true),
        rol: this.optStr(row.rol) ?? 'cliente',
        calle: this.optStr(row.calle),
        numero: this.optStr(row.numero),
        colonia: this.optStr(row.colonia),
        ciudad: this.optStr(row.ciudad),
        estado: this.optStr(row.estado),
        codigoPostal: this.optStr(row.codigoPostal),
        tipoCabello: this.optTipoCabello(row.tipoCabello),
        colorNatural: this.optStr(row.colorNatural),
        colorActual: this.optStr(row.colorActual),
        productosUsados: this.optStr(row.productosUsados),
        alergias: this.optStr(row.alergias),
        preguntaSeguridad: this.optStr(row.preguntaSeguridad),
        respuestaSeguridad: this.optStr(row.respuestaSeguridad),
      },
    });
  }

  private async importarServicio(row: Record<string, any>): Promise<void> {
    const nombre = String(row.nombre ?? row.Nombre ?? '').trim();
    const categoria = String(row.categoria ?? row.Categoria ?? '').trim();
    const precio = this.toNumber(row.precio);
    const duracionMinutos = this.toInt(row.duracionMinutos ?? row.duracion ?? 60);
    if (!nombre || !categoria) {
      throw new Error('nombre y categoria son requeridos');
    }
    if (precio === undefined || precio < 0) {
      throw new Error('El campo precio debe ser un número >= 0');
    }

    const imagen = this.toJsonArray(row.imagen ?? row.imagenes ?? []);
    const incluye = this.toJsonArray(row.incluye ?? []);
    const recomendaciones = this.toJsonArray(row.recomendaciones ?? []);

    await this.prisma.servicio.create({
      data: {
        nombre,
        descripcion: this.optStr(row.descripcion),
        descripcionLarga: this.optStr(row.descripcionLarga),
        precio: new Decimal(precio),
        duracionMinutos,
        categoria,
        requiereEvaluacion: this.toBool(row.requiereEvaluacion, false),
        imagen,
        incluye,
        recomendaciones,
        activo: this.toBool(row.activo, true),
      },
    });
  }

  async exportar(tabla: string, formato: string): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    if (!TABLAS_PERMITIDAS.includes(tabla as TablaPermitida)) {
      throw new BadRequestException(`Tabla no permitida: ${tabla}`);
    }

    const datos = await this.obtenerDatosExportar(tabla as TablaPermitida);
    const fecha = new Date().toISOString().slice(0, 10);
    const baseName = `${tabla}_${fecha}`;

    if (formato === 'json') {
      const json = JSON.stringify(datos, null, 2);
      return {
        buffer: Buffer.from(json, 'utf-8'),
        filename: `${baseName}.json`,
        contentType: 'application/json',
      };
    }

    // CSV
    if (datos.length === 0) {
      const emptyCsv = '';
      return {
        buffer: Buffer.from(emptyCsv, 'utf-8'),
        filename: `${baseName}.csv`,
        contentType: 'text/csv',
      };
    }

    const headers = this.getUniqueHeaders(datos);
    const headerLine = headers.map((h) => this.escapeCsvField(h)).join(',');
    const rows = datos.map((row) =>
      headers.map((h) => this.escapeCsvField(this.valueToStr(row[h]))).join(','),
    );
    const csv = [headerLine, ...rows].join('\n');

    return {
      buffer: Buffer.from(csv, 'utf-8'),
      filename: `${baseName}.csv`,
      contentType: 'text/csv',
    };
  }

  private async obtenerDatosExportar(tabla: TablaPermitida): Promise<Record<string, any>[]> {
    if (tabla === 'productos') {
      const list = await this.prisma.producto.findMany({
        include: { presentaciones: true },
        orderBy: { id: 'asc' },
      });
      return list.map((p) => this.sanitizeProducto(p));
    }
    if (tabla === 'usuarios') {
      const list = await this.prisma.usuario.findMany({
        orderBy: { creadoEn: 'asc' },
      });
      return list.map((u) => this.sanitizeUsuario(u));
    }
    if (tabla === 'servicios') {
      const list = await this.prisma.servicio.findMany({
        include: { productosAsociados: { include: { producto: true } }, especialistas: { include: { usuario: { select: { id: true, nombre: true, email: true } } } } },
        orderBy: { id: 'asc' },
      });
      return list.map((s) => this.sanitizeServicio(s));
    }
    throw new BadRequestException(`Tabla no implementada: ${tabla}`);
  }

  private sanitizeProducto(p: any): Record<string, any> {
    const out: Record<string, any> = {
      id: p.id,
      nombre: p.nombre,
      marca: p.marca,
      descripcion: p.descripcion,
      descripcionLarga: p.descripcionLarga,
      imagenes: Array.isArray(p.imagenes) ? p.imagenes.join('|') : p.imagenes,
      descuento: p.descuento,
      categoria: p.categoria,
      nuevo: p.nuevo,
      crueltyFree: p.crueltyFree,
      caracteristicas: Array.isArray(p.caracteristicas) ? p.caracteristicas.join('|') : p.caracteristicas,
      ingredientes: p.ingredientes,
      modoUso: p.modoUso,
      resultado: p.resultado,
    };
    if (p.presentaciones?.length) {
      out.presentaciones = p.presentaciones.map((pr: any) => ({
        tamanio: pr.tamanio,
        precio: pr.precio,
        precioOriginal: pr.precioOriginal,
        stock: pr.stock,
        disponible: pr.disponible,
        fechaCaducidad: pr.fechaCaducidad ? pr.fechaCaducidad.toISOString() : null,
      }));
    }
    return out;
  }

  private sanitizeUsuario(u: any): Record<string, any> {
    return {
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      telefono: u.telefono,
      rol: u.rol,
      activo: u.activo,
      confirmado: u.confirmado,
      creadoEn: u.creadoEn?.toISOString?.(),
      calle: u.calle,
      numero: u.numero,
      colonia: u.colonia,
      ciudad: u.ciudad,
      estado: u.estado,
      codigoPostal: u.codigoPostal,
      tipoCabello: u.tipoCabello,
      colorNatural: u.colorNatural,
      colorActual: u.colorActual,
    };
    // No exportar: password, codigoOTP, otpExpira, resetPasswordToken, tokensRevocadosDesde, etc.
  }

  private sanitizeServicio(s: any): Record<string, any> {
    return {
      id: s.id,
      nombre: s.nombre,
      descripcion: s.descripcion,
      descripcionLarga: s.descripcionLarga,
      precio: s.precio != null ? String(s.precio) : null,
      duracionMinutos: s.duracionMinutos,
      categoria: s.categoria,
      requiereEvaluacion: s.requiereEvaluacion,
      activo: s.activo,
      imagen: JSON.stringify(s.imagen ?? []),
      incluye: JSON.stringify(s.incluye ?? []),
      recomendaciones: JSON.stringify(s.recomendaciones ?? []),
      productosAsociados: (s.productosAsociados ?? []).map((pa: any) => ({
        productoId: pa.productoId,
        productoNombre: pa.producto?.nombre,
        cantidadEstimada: pa.cantidadEstimada != null ? String(pa.cantidadEstimada) : null,
      })),
      especialistas: (s.especialistas ?? []).map((e: any) => ({
        usuarioId: e.usuarioId,
        nombre: e.usuario?.nombre,
        email: e.usuario?.email,
      })),
    };
  }

  private getUniqueHeaders(datos: Record<string, any>[]): string[] {
    const set = new Set<string>();
    for (const row of datos) {
      for (const k of Object.keys(row)) {
        if (typeof row[k] === 'object' && row[k] !== null && !(row[k] instanceof Date)) {
          continue;
        }
        set.add(k);
      }
    }
    return Array.from(set).sort();
  }

  private valueToStr(v: any): string {
    if (v == null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  private escapeCsvField(s: string): string {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  private toArray(v: any): string[] {
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === 'string') return v.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
    return [];
  }

  private toJsonArray(v: any): string[] {
    const arr = this.toArray(v);
    return arr;
  }

  private optStr(v: any): string | null {
    if (v == null || v === '') return null;
    return String(v).trim() || null;
  }

  private optInt(v: any): number | null {
    if (v == null || v === '') return null;
    const n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
  }

  private toInt(v: any, def: number = 0): number {
    const n = this.optInt(v);
    return n ?? def;
  }

  private toNumber(v: any): number | undefined {
    if (v == null || v === '') return undefined;
    const n = parseFloat(String(v));
    return isNaN(n) ? undefined : n;
  }

  private toBool(v: any, def: boolean): boolean {
    if (v == null || v === '') return def;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'si';
  }

  private optDate(v: any): Date | null {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
  }

  private optTipoCabello(v: any): 'liso' | 'ondulado' | 'rizado' | null {
    const s = this.optStr(v);
    if (!s) return null;
    const low = s.toLowerCase();
    if (['liso', 'ondulado', 'rizado'].includes(low)) return low as any;
    return null;
  }

  async generarDiagrama(
    formato: 'mermaid' | 'svg' | 'png',
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const mermaidCode = generateMermaidFromSchema();
    const fecha = new Date().toISOString().slice(0, 10);
    const baseName = `diagrama-er_${fecha}`;

    if (formato === 'mermaid') {
      return {
        buffer: Buffer.from(mermaidCode, 'utf-8'),
        filename: `${baseName}.mmd`,
        contentType: 'text/plain',
      };
    }

    if (formato === 'svg') {
      const svg = await this.renderMermaidToSvg(mermaidCode);
      return {
        buffer: Buffer.from(svg, 'utf-8'),
        filename: `${baseName}.svg`,
        contentType: 'image/svg+xml',
      };
    }

    if (formato === 'png') {
      const svg = await this.renderMermaidToSvg(mermaidCode);
      const png = await this.svgToPng(svg);
      return {
        buffer: png,
        filename: `${baseName}.png`,
        contentType: 'image/png',
      };
    }

    throw new BadRequestException('formato debe ser mermaid, svg o png');
  }

  private async renderMermaidToSvg(mermaidCode: string): Promise<string> {
    try {
      const mermaid = await import('mermaid');
      mermaid.default.initialize({ startOnLoad: false });
      const { svg } = await mermaid.default.render('er-' + Date.now(), mermaidCode);
      return svg;
    } catch (e: any) {
      throw new BadRequestException(
        `No se pudo generar SVG. Usa formato=mermaid para descargar el código. Error: ${e?.message || e}`,
      );
    }
  }

  private async svgToPng(svg: string): Promise<Buffer> {
    try {
      const sharp = await import('sharp');
      return await sharp.default(Buffer.from(svg)).png().toBuffer();
    } catch (e: any) {
      throw new BadRequestException(
        `No se pudo convertir a PNG. Usa formato=svg o mermaid. Error: ${e?.message || e}`,
      );
    }
  }
}
