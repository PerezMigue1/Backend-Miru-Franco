# Modelo predictivo de cancelación de citas

## Integración

La aplicación utiliza el **Random Forest** seleccionado en la libreta
`Libreta_Clasificacion_Cancelacion_Citas_Miru_Franco_CORREGIDA`.

- Datos de entrenamiento: 3,964 citas.
- Variable objetivo: cita cancelada o no cancelada.
- Umbral de despliegue: `0.356`.
- Bandas: bajo `< 0.2136`, medio `< 0.356` y alto `>= 0.356`.
- Uso: priorizar recordatorios y confirmaciones, nunca rechazar una cita.

El modelo se entrena con Python, pero el backend ejecuta la inferencia en Node.js
mediante el artefacto comprimido
`src/citas/model/clasificacion_cancelacion_citas.model.json.gz`. Por ello,
Render no necesita Python, pandas ni scikit-learn en producción.

## Endpoint

`POST /api/citas/riesgo-cancelacion`

Requiere JWT y permiso `citas:escritura` o `citas:asignadas`.

Petición:

```json
{
  "citaIds": [101, 102]
}
```

Respuesta:

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "citaId": 101,
      "probabilidadCancelacion": 0.4516,
      "porcentajeCancelacion": 45.2,
      "prediccionCancelada": true,
      "prediccion": "cancelada",
      "nivelRiesgo": "alto",
      "accionSugerida": "Realizar confirmación prioritaria por el personal."
    }
  ]
}
```

El frontend solo manda los IDs. El backend obtiene de PostgreSQL y calcula las
18 variables con información conocida al registrar cada cita:

- anticipación, mes, día, hora y franja;
- historial previo del cliente;
- antigüedad del cliente;
- servicio, categoría, precio, duración y evaluación;
- especialista asignado.

No se utilizan el estado final, el motivo de cancelación, el check-in ni otros
datos posteriores a la cita.

## Reentrenamiento

Desde la raíz del backend:

```bash
python -m pip install -r requirements-ml.txt
python scripts/entrenar-modelo-cancelacion.py --dataset ruta/al/dataset.csv
npm run build
```

El script genera:

- `clasificacion_cancelacion_citas.joblib`, para trazabilidad y uso académico;
- `clasificacion_cancelacion_citas.model.json.gz`, para NestJS;
- `clasificacion_cancelacion_citas.metadata.json`, con métricas y variables.

Antes de guardar, el script comprueba que las probabilidades del artefacto
ejecutado sin scikit-learn coincidan con el pipeline original.
