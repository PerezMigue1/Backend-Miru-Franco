-- Producto activo: borrado lógico de productos. Eliminar un producto ya no borra la fila (pedidos,
-- ventas y movimientos de inventario la siguen referenciando): pone activo = false y el producto deja
-- de listarse y de venderse. Va DESPUÉS de 20261011120000_anticipo_en_salon.
-- Solo aditiva: no modifica ni borra datos; los productos existentes quedan en true (activos).
-- La aplica Angel en el SQL Editor de Neon y la marca con:
--   npx prisma migrate resolve --applied 20261014120000_producto_activo

-- AlterTable
ALTER TABLE "productos" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
