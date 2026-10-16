import { Reflector } from '@nestjs/core';
import { ConfiguracionSitioService, PERMISO_EQUIPO_PUBLICO, PERMISO_HORARIO, CATALOGO_PERMISOS } from './configuracion-sitio.service';
import { OperacionSitioController } from './configuracion-sitio.controller';
import { ContenidoAdminController } from '../contenido/contenido.controller';
import { establecerReglasNegocio, reglasNegocio } from './reglas-negocio';
import { puedeFirmarUso } from '../subidas/imagenes-subidas';

/** Operaciones > Horario y días inhábiles, y Equipo en el sitio: el personal con permiso los cambia sin el admin. */
describe('Panel de operaciones: horario, días inhábiles y equipo', () => {
  afterEach(() => establecerReglasNegocio(null));
  const reflector = new Reflector();

  it('las claves nuevas están en el catálogo de Permisos por rol', () => {
    const claves = CATALOGO_PERMISOS.map((c) => c.clave);
    expect(claves).toEqual(expect.arrayContaining([PERMISO_HORARIO, PERMISO_EQUIPO_PUBLICO]));
  });

  it('el controlador de operaciones pide horario:editar (no configuracion:editar)', () => {
    expect(reflector.get('permisos', OperacionSitioController)).toEqual([PERMISO_HORARIO]);
  });

  it('el equipo del sitio se edita con configuracion:editar o con equipo:publico; promociones siguen siendo solo del admin', () => {
    const proto = ContenidoAdminController.prototype as unknown as Record<string, () => unknown>;
    for (const m of ['listarEquipo', 'ordenarEquipo', 'actualizarPerfil']) {
      expect(reflector.get('permisos', proto[m])).toEqual(['configuracion:editar', PERMISO_EQUIPO_PUBLICO]);
    }
    expect(reflector.get('permisos', proto.crearPromocion)).toBeUndefined();
    expect(reflector.get('permisos', ContenidoAdminController)).toEqual(['configuracion:editar']);
  });

  it('la foto del equipo se puede subir con equipo:publico; las de promociones no', () => {
    expect(puedeFirmarUso([PERMISO_EQUIPO_PUBLICO], 'equipo')).toBe(true);
    expect(puedeFirmarUso([PERMISO_EQUIPO_PUBLICO], 'promociones')).toBe(false);
    expect(puedeFirmarUso(['*'], 'promociones')).toBe(true);
  });

  it('guardar días inhábiles se arma con lo guardado en la base (no con la copia en memoria): las demás reglas quedan igual', async () => {
    establecerReglasNegocio({ citas: { plazoAnticipoHoras: 2 } });
    const servicio = Object.create(ConfiguracionSitioService.prototype) as ConfiguracionSitioService;
    const guardar = jest.fn(async () => ({ success: true }));
    (servicio as unknown as { guardar: typeof guardar }).guardar = guardar;
    await servicio.guardarDiasInhabiles([{ fecha: '2026-12-24', motivo: 'Nochebuena' }], 'est-1', '2026-10-16T08:00:00.000Z');
    const [clave, armar, usuario, opciones] = guardar.mock.calls[0] as unknown as [string, (g: unknown) => ReturnType<typeof reglasNegocio>, string, { versionBase: string }];
    expect(clave).toBe('reglas');
    expect(usuario).toBe('est-1');
    expect(opciones.versionBase).toBe('2026-10-16T08:00:00.000Z');
    // Otra persona ya guardó 3 horas en la base: se conserva.
    const valor = armar({ citas: { plazoAnticipoHoras: 3 } });
    expect(valor.citas.plazoAnticipoHoras).toBe(3);
    expect(valor.diasInhabiles).toEqual([{ fecha: '2026-12-24', motivo: 'Nochebuena' }]);
  });

  it('si otra persona guardó la sección después de abrirla: 409 y no se pisa su cambio', async () => {
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      configuracionSitio: { findUnique: jest.fn(async () => ({ clave: 'horario', valor: {}, actualizadoEn: new Date('2026-10-16T09:00:00.000Z') })), upsert: jest.fn() },
      historialConfiguracionSitio: { create: jest.fn() },
    };
    const prisma = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    const servicio = Object.create(ConfiguracionSitioService.prototype) as ConfiguracionSitioService;
    Object.assign(servicio, { prisma, resolverImagenesSeccion: async (_c: string, v: unknown) => v });
    const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].map((dia) => ({ dia, cerrado: dia === 'domingo', abre: dia === 'domingo' ? '' : '09:30', cierra: dia === 'domingo' ? '' : '19:30' }));
    await expect(servicio.guardar('horario', { dias }, 'adm-1', { versionBase: '2026-10-16T08:00:00.000Z' })).rejects.toThrow(/Otra persona guardó/);
    expect(tx.configuracionSitio.upsert).not.toHaveBeenCalled();
  });
});
