#!/usr/bin/env python3
"""Entrena y exporta el modelo de cancelación usado por el backend.

El entrenamiento reproduce la libreta
`Libreta_Clasificacion_Cancelacion_Citas_Miru_Franco_CORREGIDA`:

* mismas 18 variables;
* mismo Random Forest y semilla;
* mismo holdout agrupado y umbral de despliegue reportado por la libreta;
* reentrenamiento final con todas las citas.

Se generan dos artefactos:

1. ``clasificacion_cancelacion_citas.joblib`` para trazabilidad académica.
2. ``clasificacion_cancelacion_citas.model.json.gz`` para inferencia nativa
   en NestJS, sin instalar Python ni scikit-learn en producción.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


RANDOM_STATE = 42
# Umbral reportado y validado en la libreta entregada. Se conserva como
# contrato de despliegue aunque una versión distinta de scikit-learn pueda
# mover unas milésimas el máximo de F1 al recalcular las predicciones OOF.
UMBRAL_LIBRETA = 0.356
FEATURES_NUMERICAS = [
    "dias_anticipacion",
    "hora_cita",
    "mes_cita",
    "es_fin_semana",
    "citas_previas_cliente",
    "cancelaciones_previas_cliente",
    "completadas_previas_cliente",
    "tasa_cancelacion_cliente",
    "cliente_nuevo",
    "antiguedad_cliente_dias",
    "precio_servicio",
    "duracion_servicio",
    "requiere_evaluacion",
]
FEATURES_CATEGORICAS = [
    "dia_semana",
    "franja_horaria",
    "servicio_id",
    "categoria_servicio",
    "especialista_id",
]
FEATURES = FEATURES_NUMERICAS + FEATURES_CATEGORICAS
TARGET = "cancelada"
GROUP_COLUMN = "cliente_grupo"


def numero_json(value: Any) -> int | float:
    """Convierte escalares de NumPy sin perder precisión para la inferencia."""
    if isinstance(value, (np.integer, int)):
        return int(value)
    return float(value)


def metricas(y_real: pd.Series, prediccion: np.ndarray, probabilidad: np.ndarray) -> dict[str, float]:
    return {
        "accuracy": float(accuracy_score(y_real, prediccion)),
        "balanced_accuracy": float(balanced_accuracy_score(y_real, prediccion)),
        "precision": float(precision_score(y_real, prediccion, zero_division=0)),
        "recall": float(recall_score(y_real, prediccion, zero_division=0)),
        "f1": float(f1_score(y_real, prediccion, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_real, probabilidad)),
        "pr_auc": float(average_precision_score(y_real, probabilidad)),
    }


def crear_pipeline() -> Pipeline:
    pipeline_numerico = Pipeline(
        steps=[
            ("imputacion", SimpleImputer(strategy="median")),
            ("escalado", StandardScaler()),
        ]
    )
    pipeline_categorico = Pipeline(
        steps=[
            ("imputacion", SimpleImputer(strategy="most_frequent")),
            (
                "one_hot",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
            ),
        ]
    )
    preprocesador = ColumnTransformer(
        transformers=[
            ("numericas", pipeline_numerico, FEATURES_NUMERICAS),
            ("categoricas", pipeline_categorico, FEATURES_CATEGORICAS),
        ],
        verbose_feature_names_out=False,
    )
    modelo = RandomForestClassifier(
        n_estimators=350,
        min_samples_leaf=2,
        max_features="sqrt",
        class_weight="balanced_subsample",
        n_jobs=-1,
        random_state=RANDOM_STATE,
    )
    return Pipeline(
        steps=[
            ("preprocesamiento", preprocesador),
            ("modelo", modelo),
        ]
    )


def exportar_runtime(
    pipeline: Pipeline,
    umbral: float,
    umbral_oof_entorno: float,
    metricas_holdout: dict[str, float],
    filas: int,
) -> dict[str, Any]:
    preprocesador: ColumnTransformer = pipeline.named_steps["preprocesamiento"]
    bosque: RandomForestClassifier = pipeline.named_steps["modelo"]

    pipe_numerico: Pipeline = preprocesador.named_transformers_["numericas"]
    imputador_numerico: SimpleImputer = pipe_numerico.named_steps["imputacion"]
    escalador: StandardScaler = pipe_numerico.named_steps["escalado"]

    pipe_categorico: Pipeline = preprocesador.named_transformers_["categoricas"]
    imputador_categorico: SimpleImputer = pipe_categorico.named_steps["imputacion"]
    one_hot: OneHotEncoder = pipe_categorico.named_steps["one_hot"]

    numericas = []
    for indice, nombre in enumerate(FEATURES_NUMERICAS):
        numericas.append(
            {
                "nombre": nombre,
                "imputacion": numero_json(imputador_numerico.statistics_[indice]),
                "media": numero_json(escalador.mean_[indice]),
                "escala": numero_json(escalador.scale_[indice]),
            }
        )

    categoricas = []
    for indice, nombre in enumerate(FEATURES_CATEGORICAS):
        categoricas.append(
            {
                "nombre": nombre,
                "imputacion": str(imputador_categorico.statistics_[indice]),
                "categorias": [str(valor) for valor in one_hot.categories_[indice].tolist()],
            }
        )

    arboles = []
    for estimador in bosque.estimators_:
        arbol = estimador.tree_
        valores = arbol.value[:, 0, :]
        sumas = valores.sum(axis=1)
        probabilidades_clase_1 = np.divide(
            valores[:, 1],
            sumas,
            out=np.zeros(arbol.node_count, dtype=float),
            where=sumas != 0,
        )
        arboles.append(
            {
                "izquierda": arbol.children_left.astype(int).tolist(),
                "derecha": arbol.children_right.astype(int).tolist(),
                "variable": arbol.feature.astype(int).tolist(),
                "umbral": [numero_json(v) for v in arbol.threshold.tolist()],
                "probabilidad_clase_1": [
                    numero_json(v) for v in probabilidades_clase_1.tolist()
                ],
            }
        )

    return {
        "version_esquema": 1,
        "nombre": "clasificacion_cancelacion_citas",
        "modelo": "Random Forest",
        "origen": "Libreta_Clasificacion_Cancelacion_Citas_Miru_Franco_CORREGIDA",
        "random_state": RANDOM_STATE,
        "filas_entrenamiento": filas,
        "version_sklearn": sklearn.__version__,
        "features": FEATURES,
        "preprocesamiento": {
            "numericas": numericas,
            "categoricas": categoricas,
        },
        "bosque": {
            "numero_clases": 2,
            "numero_arboles": len(arboles),
            "arboles": arboles,
        },
        "umbral": numero_json(umbral),
        "umbral_oof_entorno": numero_json(umbral_oof_entorno),
        "umbrales_riesgo": {
            "medio": numero_json(umbral * 0.60),
            "alto": numero_json(umbral),
        },
        "metricas_holdout_clientes": {
            clave: numero_json(valor) for clave, valor in metricas_holdout.items()
        },
    }


def transformar_registro_runtime(registro: dict[str, Any], artefacto: dict[str, Any]) -> list[float]:
    vector: list[float] = []
    for regla in artefacto["preprocesamiento"]["numericas"]:
        valor = registro.get(regla["nombre"], regla["imputacion"])
        try:
            numero = float(valor)
        except (TypeError, ValueError):
            numero = float(regla["imputacion"])
        escala = float(regla["escala"]) or 1.0
        # Los árboles de scikit-learn evalúan la matriz de entrada como float32.
        # Mantener esta conversión evita cambiar de rama en valores limítrofes.
        vector.append(float(np.float32((numero - float(regla["media"])) / escala)))

    for regla in artefacto["preprocesamiento"]["categoricas"]:
        valor = str(registro.get(regla["nombre"], regla["imputacion"]))
        vector.extend(1.0 if valor == categoria else 0.0 for categoria in regla["categorias"])
    return vector


def predecir_runtime(registro: dict[str, Any], artefacto: dict[str, Any]) -> float:
    vector = transformar_registro_runtime(registro, artefacto)
    acumulado = 0.0
    for arbol in artefacto["bosque"]["arboles"]:
        nodo = 0
        while arbol["variable"][nodo] >= 0:
            variable = arbol["variable"][nodo]
            nodo = (
                arbol["izquierda"][nodo]
                if vector[variable] <= arbol["umbral"][nodo]
                else arbol["derecha"][nodo]
            )
        acumulado += arbol["probabilidad_clase_1"][nodo]
    return acumulado / artefacto["bosque"]["numero_arboles"]


def main() -> None:
    raiz = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        required=True,
        help="CSV generado por la consulta de clasificación.",
    )
    parser.add_argument(
        "--salida",
        type=Path,
        default=raiz / "src" / "citas" / "model",
        help="Directorio de salida de los artefactos.",
    )
    parser.add_argument(
        "--umbral",
        type=float,
        default=UMBRAL_LIBRETA,
        help="Umbral de despliegue. Por defecto conserva el 0.356 de la libreta.",
    )
    args = parser.parse_args()

    df = pd.read_csv(args.dataset)
    faltantes = [columna for columna in FEATURES + [TARGET, GROUP_COLUMN] if columna not in df]
    if faltantes:
        raise ValueError(f"El dataset no contiene estas columnas: {faltantes}")
    if df[FEATURES + [TARGET, GROUP_COLUMN]].isna().any().any():
        raise ValueError("El dataset contiene nulos en las columnas necesarias.")

    df["servicio_id"] = df["servicio_id"].astype(str)
    X = df[FEATURES].copy()
    y = df[TARGET].astype(int).copy()
    grupos = df[GROUP_COLUMN].astype(str).copy()

    holdout_cv = StratifiedGroupKFold(
        n_splits=5,
        shuffle=True,
        random_state=RANDOM_STATE,
    )
    indices_train, indices_test = next(holdout_cv.split(X, y, groups=grupos))
    X_train = X.iloc[indices_train].copy()
    X_test = X.iloc[indices_test].copy()
    y_train = y.iloc[indices_train].copy()
    y_test = y.iloc[indices_test].copy()
    grupos_train = grupos.iloc[indices_train].copy()

    pipeline = crear_pipeline()
    cv = StratifiedGroupKFold(
        n_splits=7,
        shuffle=True,
        random_state=RANDOM_STATE,
    )
    probabilidades_oof = cross_val_predict(
        clone(pipeline),
        X_train,
        y_train,
        groups=grupos_train,
        cv=cv,
        method="predict_proba",
        n_jobs=-1,
    )[:, 1]
    precision_oof, recall_oof, umbrales_oof = precision_recall_curve(
        y_train,
        probabilidades_oof,
    )
    f1_oof = (
        2 * precision_oof[:-1] * recall_oof[:-1]
        / (precision_oof[:-1] + recall_oof[:-1] + 1e-12)
    )
    umbral_oof_entorno = float(umbrales_oof[int(np.nanargmax(f1_oof))])
    umbral = float(args.umbral)

    modelo_evaluacion = clone(pipeline)
    modelo_evaluacion.fit(X_train, y_train)
    probabilidad_test = modelo_evaluacion.predict_proba(X_test)[:, 1]
    prediccion_test = (probabilidad_test >= umbral).astype(int)
    metricas_holdout = metricas(y_test, prediccion_test, probabilidad_test)

    modelo_despliegue = clone(pipeline)
    modelo_despliegue.fit(X, y)

    artefacto_joblib = {
        "pipeline": modelo_despliegue,
        "umbral": umbral,
        "umbrales_riesgo": {"medio": umbral * 0.60, "alto": umbral},
        "features": FEATURES,
        "features_numericas": FEATURES_NUMERICAS,
        "features_categoricas": FEATURES_CATEGORICAS,
        "target": TARGET,
        "group_column": GROUP_COLUMN,
        "mapeo_clases": {0: "Completada", 1: "Cancelada"},
        "modelo_seleccionado": "Random Forest",
        "metricas_holdout_clientes": metricas_holdout,
        "random_state": RANDOM_STATE,
        "filas_entrenamiento_despliegue": len(X),
        "version_sklearn": sklearn.__version__,
        "umbral_oof_entorno": umbral_oof_entorno,
    }
    artefacto_runtime = exportar_runtime(
        modelo_despliegue,
        umbral,
        umbral_oof_entorno,
        metricas_holdout,
        len(X),
    )

    # Verifica que la inferencia nativa y scikit-learn coincidan.
    muestra = X.head(min(100, len(X)))
    probabilidades_sklearn = modelo_despliegue.predict_proba(muestra)[:, 1]
    probabilidades_runtime = np.array(
        [
            predecir_runtime(registro, artefacto_runtime)
            for registro in muestra.to_dict(orient="records")
        ]
    )
    if not np.allclose(probabilidades_sklearn, probabilidades_runtime, atol=1e-10):
        diferencia = float(np.max(np.abs(probabilidades_sklearn - probabilidades_runtime)))
        raise RuntimeError(f"La exportación no reproduce el modelo; diferencia máxima={diferencia}")

    args.salida.mkdir(parents=True, exist_ok=True)
    ruta_joblib = args.salida / "clasificacion_cancelacion_citas.joblib"
    ruta_runtime = args.salida / "clasificacion_cancelacion_citas.model.json.gz"
    ruta_metadata = args.salida / "clasificacion_cancelacion_citas.metadata.json"

    joblib.dump(artefacto_joblib, ruta_joblib, compress=3)
    contenido_json = json.dumps(
        artefacto_runtime,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    with gzip.open(ruta_runtime, "wb", compresslevel=9) as archivo:
        archivo.write(contenido_json)

    metadata = {
        clave: artefacto_runtime[clave]
        for clave in [
            "version_esquema",
            "nombre",
            "modelo",
            "origen",
            "random_state",
            "filas_entrenamiento",
            "version_sklearn",
            "features",
            "umbral",
            "umbral_oof_entorno",
            "umbrales_riesgo",
            "metricas_holdout_clientes",
        ]
    }
    ruta_metadata.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Modelo seleccionado: Random Forest")
    print(f"Umbral de despliegue (libreta): {umbral:.6f}")
    print(f"Umbral OOF recalculado en este entorno: {umbral_oof_entorno:.6f}")
    print(f"Métricas holdout: {json.dumps(metricas_holdout, ensure_ascii=False)}")
    print(f"Joblib: {ruta_joblib} ({ruta_joblib.stat().st_size:,} bytes)")
    print(f"Runtime NestJS: {ruta_runtime} ({ruta_runtime.stat().st_size:,} bytes)")
    print(f"Metadata: {ruta_metadata}")


if __name__ == "__main__":
    main()
