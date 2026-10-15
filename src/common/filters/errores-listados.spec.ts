import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductosService } from '../../productos/productos.service';
import { ServiciosService } from '../../servicios/servicios.service';

/**
 * Si la base falla al listar productos o servicios, el error original llega al filtro global (que responde 503 o
 * 500 con un mensaje genérico). Antes se envolvía en un 400 con el mensaje crudo de Prisma, que incluía rutas del
 * servidor y fragmentos de código.
 */
const errorDeConexion = () =>
  new Prisma.PrismaClientInitializationError("Can't reach database server at C:\\Users\\x\\dist\\productos.service.js:148", '5.22.0');

describe('Listados públicos: un fallo de la base no se convierte en 400 con detalles internos', () => {
  it('GET /productos relanza el error original', async () => {
    const prisma: any = { producto: { findMany: jest.fn().mockRejectedValue(errorDeConexion()) } };
    const servicio = new ProductosService(prisma);
    const error = await servicio.listar().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientInitializationError);
    expect(error).not.toBeInstanceOf(BadRequestException);
  });

  it('GET /servicios relanza el error original', async () => {
    const prisma: any = { servicio: { findMany: jest.fn().mockRejectedValue(errorDeConexion()) } };
    const servicio = new ServiciosService(prisma);
    const error = await servicio.listar().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientInitializationError);
    expect(error).not.toBeInstanceOf(BadRequestException);
  });
});
