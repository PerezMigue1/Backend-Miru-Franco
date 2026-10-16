import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { establecerReglasNegocio } from '../configuracion-sitio/reglas-negocio';
import { PERMISO_CONFIGURACION } from '../configuracion-sitio/configuracion-sitio.service';
import { DEFINICION_POR_CLAVE } from './catalogo';
import { TextosSitioController } from './textos-sitio.controller';
import { TextosSitioService } from './textos-sitio.service';
import { establecerTextosSitio, llenarVariables, textoSitio, textosPublicos } from './textos-sitio.util';

/**
 * Textos del sitio: guardar con validación (largo, variables existentes, llaves, sin HTML), restaurar el original,
 * historial de solo inserción, carga en memoria para correos y avisos, y variables de reglas y de contexto.
 */
function montar(inicial: Record<string, { valor: string; actualizadoPorId: string | null }> = {}) {
  const filas = new Map(Object.entries(inicial).map(([clave, f]) => [clave, { clave, ...f, actualizadoEn: new Date('2026-10-16T10:00:00Z') }]));
  const historial: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    textoSitio: {
      findUnique: jest.fn(async ({ where }: any) => filas.get(where.clave) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const actual = filas.get(where.clave);
        const fila = { ...(actual ?? create), ...(actual ? update : {}), clave: where.clave, actualizadoEn: new Date() };
        filas.set(where.clave, fila);
        return fila;
      }),
    },
    historialTextoSitio: { create: jest.fn(async ({ data }: any) => historial.push({ id: historial.length + 1, creadoEn: new Date(), ...data })) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    textoSitio: {
      ...tx.textoSitio,
      findMany: jest.fn(async () => [...filas.values()]),
    },
    historialTextoSitio: {
      ...tx.historialTextoSitio,
      findMany: jest.fn(async ({ where }: any) => historial.filter((h) => h.clave === where.clave).reverse()),
    },
    usuario: { findMany: jest.fn(async () => [{ id: 'admin-1', nombre: 'Dueña' }]) },
  };
  const configuracionSitio = { invalidarCachePublica: jest.fn() };
  const servicio = new TextosSitioService(prisma as any, configuracionSitio as any);
  return { servicio, prisma, filas, historial, configuracionSitio };
}

afterEach(() => {
  establecerTextosSitio([]);
  establecerReglasNegocio(null);
});

describe('Guardar un texto', () => {
  it('guarda, deja historial con el valor anterior, actualiza la memoria y borra la caché pública', async () => {
    const { servicio, historial, configuracionSitio } = montar();
    const r = await servicio.guardar('citas.crear.botonConfirmar', '  Agendar mi cita  ', 'admin-1');
    expect(r).toMatchObject({ success: true, clave: 'citas.crear.botonConfirmar', valor: 'Agendar mi cita', restaurado: false });
    expect(historial).toEqual([expect.objectContaining({ clave: 'citas.crear.botonConfirmar', valorAnterior: 'Confirmar cita', valorNuevo: 'Agendar mi cita', actualizadoPorId: 'admin-1' })]);
    expect(textoSitio('citas.crear.botonConfirmar')).toBe('Agendar mi cita');
    expect(configuracionSitio.invalidarCachePublica).toHaveBeenCalled();
  });

  it('rechaza variables que no existen para ese texto (400 en español, con su nombre)', async () => {
    const { servicio, historial } = montar();
    await expect(servicio.guardar('citas.crear.botonConfirmar', 'Confirmar {servicio}', 'admin-1')).rejects.toThrow(BadRequestException);
    try {
      await servicio.guardar('avisos.citaCreada.mensaje', 'Tu cita de {servicio} es {inventada}', 'admin-1');
    } catch (e) {
      expect(JSON.stringify((e as BadRequestException).getResponse())).toContain('{inventada}');
    }
    expect(historial).toEqual([]);
  });

  it('acepta las variables de reglas y las de contexto de la clave', async () => {
    const { servicio } = montar();
    await expect(servicio.guardar('avisos.citaCreada.mensaje', 'Tu cita de {servicio} el {fecha}. Llega {minutosLlegadaAntes} min antes.', 'admin-1')).resolves.toMatchObject({ success: true });
  });

  it.each([
    ['más largo que el máximo', 'x'.repeat(41), 'como máximo 40'],
    ['vacío', '   ', 'Escribe el texto'],
    ['con HTML', 'Confirmar <b>cita</b>', 'sin etiquetas HTML'],
    ['con una llave suelta', 'Confirmar {cita', 'llaves'],
    ['con salto de línea en un texto de una línea', 'Confirmar\ncita', 'una sola línea'],
  ])('rechaza un texto %s', async (_caso, valor, error) => {
    const { servicio } = montar();
    await expect(servicio.guardar('citas.crear.botonConfirmar', valor, 'admin-1')).rejects.toThrow(BadRequestException);
    await servicio.guardar('citas.crear.botonConfirmar', valor, 'admin-1').catch((e: BadRequestException) => {
      expect(JSON.stringify(e.getResponse())).toContain(error);
    });
  });

  it('una clave que no está en el catálogo es 404', async () => {
    const { servicio } = montar();
    await expect(servicio.guardar('no.existe', 'Hola', 'admin-1')).rejects.toThrow(NotFoundException);
    await expect(servicio.historial('no.existe')).rejects.toThrow(NotFoundException);
  });
});

describe('Restaurar el texto original e historial', () => {
  it('restaurar vuelve al valor por defecto y queda en el historial marcado como restaurado', async () => {
    const { servicio, historial } = montar({ 'pedidos.lista.vacia': { valor: 'Aún no compras nada', actualizadoPorId: 'admin-1' } });
    await servicio.refrescar();
    expect(textoSitio('pedidos.lista.vacia')).toBe('Aún no compras nada');
    const r = await servicio.restaurar('pedidos.lista.vacia', 'admin-1');
    expect(r).toMatchObject({ valor: 'No tienes pedidos realizados', restaurado: true });
    expect(historial).toEqual([expect.objectContaining({ valorAnterior: 'Aún no compras nada', valorNuevo: 'No tienes pedidos realizados', restaurado: true })]);
    expect(textoSitio('pedidos.lista.vacia')).toBe('No tienes pedidos realizados');
  });

  it('historial: lo más reciente primero, con el nombre de quien lo cambió', async () => {
    const { servicio } = montar();
    await servicio.guardar('pedidos.lista.vacia', 'Uno', 'admin-1');
    await servicio.guardar('pedidos.lista.vacia', 'Dos', 'admin-1');
    const { data } = await servicio.historial('pedidos.lista.vacia');
    expect(data.map((h) => h.valorNuevo)).toEqual(['Dos', 'Uno']);
    expect(data[0]).toMatchObject({ valorAnterior: 'Uno', actualizadoPor: 'Dueña', restaurado: false });
  });

  it('listar trae el catálogo con valor actual, por defecto, largo, variables y quién lo cambió (la semilla no cuenta)', async () => {
    const { servicio } = montar({
      'pedidos.lista.vacia': { valor: 'Aún no compras nada', actualizadoPorId: 'admin-1' },
      'citas.lista.vacia': { valor: 'No tienes citas agendadas', actualizadoPorId: null },
    });
    const { data, paginas } = await servicio.listar();
    expect(paginas).toContain('Correos');
    const pedidos = data.find((t) => t.clave === 'pedidos.lista.vacia')!;
    expect(pedidos).toMatchObject({ valor: 'Aún no compras nada', porDefecto: 'No tienes pedidos realizados', personalizado: true, actualizadoPor: 'Dueña', max: 80 });
    expect(data.find((t) => t.clave === 'citas.lista.vacia')).toMatchObject({ personalizado: false, actualizadoPor: null, actualizadoEn: null });
    const aviso = data.find((t) => t.clave === 'avisos.pedidoVencido.sinPreparar')!;
    expect(aviso.variables.map((v) => v.nombre)).toEqual(expect.arrayContaining(['pedido', 'diasPrepararApartado']));
    expect(aviso.variables.find((v) => v.nombre === 'diasPrepararApartado')).toMatchObject({ origen: 'regla', ejemplo: '3' });
  });
});

describe('Variables y memoria', () => {
  it('texto() llena las reglas vigentes y las de contexto (que ganan); una variable sin valor queda vacía', () => {
    establecerReglasNegocio({ tienda: { diasPrepararApartado: 5 } });
    expect(textoSitio('avisos.pedidoVencido.sinPreparar', { pedido: 9 })).toBe('Tu apartado #9 se canceló porque no se preparó en 5 días. Puedes volver a pedirlo en la tienda.');
    expect(textoSitio('avisos.pedidoVencido.sinPreparar', { pedido: 9, diasPrepararApartado: '2' })).toContain('en 2 días');
    expect(textoSitio('avisos.pedidoVencido.sinPreparar')).toBe('Tu apartado # se canceló porque no se preparó en 5 días. Puedes volver a pedirlo en la tienda.');
    expect(llenarVariables('Hola {x}', {})).toBe('Hola ');
    expect(llenarVariables('Hola {x}', {}, true)).toBe('Hola {x}');
  });

  it('un valor guardado inválido (editado a mano en la base) usa el de hoy', () => {
    establecerTextosSitio([{ clave: 'citas.crear.botonConfirmar', valor: '<script>x</script>' }, { clave: 'no.existe', valor: 'x' }]);
    expect(textoSitio('citas.crear.botonConfirmar')).toBe('Confirmar cita');
  });

  it('si la base falla al refrescar se conservan los textos vigentes', async () => {
    const { servicio, prisma } = montar({ 'pedidos.lista.vacia': { valor: 'Guardado', actualizadoPorId: 'admin-1' } });
    await servicio.refrescar();
    prisma.textoSitio.findMany.mockRejectedValueOnce(new Error('sin base'));
    jest.spyOn((servicio as any).logger, 'warn').mockImplementation(() => undefined);
    await servicio.refrescar();
    expect(textoSitio('pedidos.lista.vacia')).toBe('Guardado');
  });

  it('textos públicos: solo los de tipo texto, con las reglas llenas y las de contexto con llaves', () => {
    establecerReglasNegocio({ tienda: { tiempoPreparacionTexto: 'Listo en 2 días' } });
    const publicos = textosPublicos();
    expect(Object.keys(publicos).every((c) => DEFINICION_POR_CLAVE.get(c)?.tipo === 'texto')).toBe(true);
    expect(Object.keys(publicos).some((c) => c.startsWith('correos.') || c.startsWith('avisos.'))).toBe(false);
    expect(publicos['checkout.recogerAviso']).toBe('Listo en 2 días. Te avisamos en la app y por correo cuando puedas pasar por él.');
    expect(publicos['citas.pagoSalon.saldo']).toContain('{saldo}');
  });
});

describe('Endpoints', () => {
  it('todo el controlador pide sesión y configuracion:editar (solo admin)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TextosSitioController)).toContain(PermisosGuard);
    expect(Reflect.getMetadata('permisos', TextosSitioController)).toEqual([PERMISO_CONFIGURACION]);
  });
});
