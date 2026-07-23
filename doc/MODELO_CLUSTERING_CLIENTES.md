# Segmentación de clientes por patrones de compra

## Integración

La aplicación ejecuta el **K-Means de cuatro grupos** entrenado en la libreta
`MIRUFRANCO_Clustering_COMPLETA_CORREGIDA`.

- Datos de entrenamiento: 1,017 clientes.
- Variables: frecuencia, productos, servicios, gasto, ticket promedio,
  proporción de gasto en línea y recencia.
- Preprocesamiento: `log1p` en variables sesgadas y estandarización.
- Métricas: Silhouette `0.5860`, Davies-Bouldin `0.7415` y
  Calinski-Harabasz `3108.32`.

El resultado es un segmento comercial, no una probabilidad ni una clase
correcta/incorrecta:

1. Sin compras registradas.
2. Recientes de consumo bajo.
3. Clientes ocasionales por reactivar.
4. Frecuentes de alto valor.

## Endpoints

Ambos requieren JWT y permiso `clientes:lectura`.

```http
GET /api/clientes/segmentacion?incluirInactivos=true
GET /api/clientes/:id/segmentacion
```

El backend calcula las variables directamente desde:

- pedidos en línea no cancelados;
- artículos de `pedido_items`;
- ventas locales pagadas;
- artículos locales que respetan la exclusión entre `presentacion_id` y
  `servicio_id`;
- fechas de la compra más reciente de cada canal.

La recencia se actualiza con la fecha del servidor. No se solicita al
administrador capturar las variables manualmente.

## Artefactos

- `clustering_patrones_compra.joblib`: trazabilidad académica.
- `clustering_patrones_compra.model.json`: inferencia en NestJS sin Python.
- `clustering_patrones_compra.metadata.json`: métricas y segmentos.

## Reentrenamiento

Desde la raíz del backend:

```bash
python -m pip install -r requirements-ml.txt
python scripts/entrenar-modelo-clustering.py \
  --dataset ruta/al/MIRUFRANCO.csv
npm run build
```

El clustering debe reentrenarse cuando cambie de manera importante el
historial real de compras. Su salida apoya promociones y fidelización; no debe
utilizarse para excluir o perjudicar clientes.
