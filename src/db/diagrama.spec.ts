import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { DbController } from './db.controller';
import { DbService } from './db.service';

function resMock() {
  return { setHeader: jest.fn(), send: jest.fn() } as unknown as Response & {
    setHeader: jest.Mock;
    send: jest.Mock;
  };
}

describe('GET /api/db/diagram', () => {
  const controller = new DbController(new DbService({} as any), {} as any);

  it.each([undefined, '', 'mermaid', 'MERMAID'])(
    'formato=%p entrega el código Mermaid del schema',
    async (formato) => {
      const res = resMock();

      await controller.diagrama(formato as string, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(/^attachment; filename="diagrama-er_\d{4}-\d{2}-\d{2}\.mmd"$/),
      );
      expect((res.send.mock.calls[0][0] as Buffer).toString('utf-8')).toContain('erDiagram');
    },
  );

  it.each(['png', 'svg', 'pdf'])(
    'formato=%s responde 400 con un mensaje claro',
    async (formato) => {
      const res = resMock();

      const error = await controller.diagrama(formato, res).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getStatus()).toBe(400);
      expect(error.message).toBe(
        'Formato no soportado: el diagrama solo se entrega como mermaid (formato=mermaid).',
      );
      expect(res.send).not.toHaveBeenCalled();
    },
  );
});
