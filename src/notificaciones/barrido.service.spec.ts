import { BarridoService } from './barrido.service';

describe('Barrida programada', () => {
  it('cada tick drena las notificaciones y avisa a las demás reglas (apartados vencidos)', async () => {
    const despachador = { drenarPendientes: jest.fn(async () => undefined) };
    const eventos = { emitAsync: jest.fn(async () => []) };
    await new BarridoService(despachador as any, eventos as any).tick();
    expect(despachador.drenarPendientes).toHaveBeenCalledTimes(1);
    expect(eventos.emitAsync).toHaveBeenCalledWith('barrido.tick');
  });

  it('si drenar falla, las demás reglas igual corren', async () => {
    const despachador = { drenarPendientes: jest.fn(async () => { throw new Error('sin base'); }) };
    const eventos = { emitAsync: jest.fn(async () => []) };
    await new BarridoService(despachador as any, eventos as any).tick();
    expect(eventos.emitAsync).toHaveBeenCalledWith('barrido.tick');
  });
});
