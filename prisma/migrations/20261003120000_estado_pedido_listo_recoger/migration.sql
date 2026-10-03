-- Solo agrega un valor al enum: no borra, renombra ni cambia columnas ni datos.
-- "Listo para recoger": el pedido ya está en el salón esperando a la clienta.
ALTER TYPE "EstadoPedido" ADD VALUE IF NOT EXISTS 'listo_recoger' AFTER 'preparando';
