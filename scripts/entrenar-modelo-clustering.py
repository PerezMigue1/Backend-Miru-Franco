#!/usr/bin/env python3
"""Entrena y exporta el clustering de patrones de compra para NestJS.

La preparación y el K-Means reproducen la libreta
MIRUFRANCO_Clustering_COMPLETA_CORREGIDA. Además del artefacto joblib para
trazabilidad académica, genera un JSON pequeño que el backend ejecuta sin
Python ni scikit-learn en producción.
"""

from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    calinski_harabasz_score,
    davies_bouldin_score,
    silhouette_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler


RANDOM_STATE = 42
K_FINAL = 4
FEATURES = [
    "frecuencia_total",
    "productos_totales",
    "servicios_comprados",
    "gasto_total",
    "ticket_promedio",
    "proporcion_online",
    "recencia_dias",
]
FEATURES_SESGADAS = [
    "frecuencia_total",
    "productos_totales",
    "servicios_comprados",
    "gasto_total",
    "ticket_promedio",
    "recencia_dias",
]
FEATURES_ACOTADAS = ["proporcion_online"]
COLUMNAS_NUMERICAS_ORIGEN = [
    "compras_online",
    "compras_locales",
    "productos_online",
    "productos_locales",
    "servicios_comprados",
    "gasto_online",
    "gasto_local",
]
COLUMNAS_FECHAS = [
    "fecha_ultima_compra_online",
    "fecha_ultima_compra_local",
]
VALORES_AUSENTES_NEGOCIO = [
    "Sin compra online",
    "Sin compra local",
    "Sin compras",
    "No compró servicios",
    "No compró productos",
    "Sin categoría",
    "Sin marca",
    "Sin presentación",
]


def construir_preprocesador() -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            (
                "variables_sesgadas",
                Pipeline(
                    steps=[
                        ("imputacion", SimpleImputer(strategy="median")),
                        (
                            "log1p",
                            FunctionTransformer(
                                np.log1p,
                                feature_names_out="one-to-one",
                            ),
                        ),
                        ("escalado", StandardScaler()),
                    ]
                ),
                FEATURES_SESGADAS,
            ),
            (
                "proporcion",
                Pipeline(
                    steps=[
                        (
                            "imputacion",
                            SimpleImputer(strategy="constant", fill_value=0),
                        ),
                        ("escalado", StandardScaler()),
                    ]
                ),
                FEATURES_ACOTADAS,
            ),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def preparar_datos(dataset: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.Timestamp, float]:
    df_raw = pd.read_csv(dataset)
    faltantes = sorted(
        set(
            ["id_cliente", *COLUMNAS_NUMERICAS_ORIGEN, *COLUMNAS_FECHAS]
        ).difference(df_raw.columns)
    )
    if faltantes:
        raise ValueError(
            "El dataset no contiene las columnas requeridas: "
            + ", ".join(faltantes)
        )

    df = df_raw.replace(VALORES_AUSENTES_NEGOCIO, np.nan).copy()
    for columna in COLUMNAS_FECHAS:
        df[columna] = pd.to_datetime(df[columna], errors="coerce")

    for columna in COLUMNAS_NUMERICAS_ORIGEN:
        df[columna] = pd.to_numeric(df[columna], errors="coerce").fillna(0)
        if (df[columna] < 0).any():
            raise ValueError(f"La columna {columna} contiene valores negativos.")

    df["ultima_compra"] = df[COLUMNAS_FECHAS].max(axis=1)
    fecha_maxima = max(df[columna].max() for columna in COLUMNAS_FECHAS)
    if pd.isna(fecha_maxima):
        raise ValueError("El dataset no contiene fechas de compra válidas.")
    fecha_corte = fecha_maxima.normalize()

    df["frecuencia_total"] = df["compras_online"] + df["compras_locales"]
    df["productos_totales"] = (
        df["productos_online"] + df["productos_locales"]
    )
    df["gasto_total"] = df["gasto_online"] + df["gasto_local"]
    df["ticket_promedio"] = np.where(
        df["frecuencia_total"] > 0,
        df["gasto_total"] / df["frecuencia_total"],
        0.0,
    )
    df["proporcion_online"] = np.where(
        df["gasto_total"] > 0,
        df["gasto_online"] / df["gasto_total"],
        0.0,
    )

    recencia_observada = (
        fecha_corte - df["ultima_compra"]
    ).dt.total_seconds() / 86_400
    recencia_sin_compra = float(np.ceil(recencia_observada.max() + 30))
    df["recencia_dias"] = (
        recencia_observada.fillna(recencia_sin_compra).clip(lower=0)
    )

    return df, df[FEATURES].copy(), fecha_corte, recencia_sin_compra


def definir_segmentos(
    df: pd.DataFrame,
) -> tuple[dict[int, str], dict[int, str], pd.DataFrame]:
    perfil_promedio = df.groupby("cluster")[FEATURES].mean()
    cluster_inactivo = int(perfil_promedio["gasto_total"].idxmin())
    cluster_alto_valor = int(perfil_promedio["gasto_total"].idxmax())
    restantes = [
        int(cluster)
        for cluster in perfil_promedio.index
        if cluster not in {cluster_inactivo, cluster_alto_valor}
    ]
    cluster_reciente_bajo = int(
        perfil_promedio.loc[restantes, "frecuencia_total"].idxmin()
    )
    cluster_ocasional = next(
        cluster for cluster in restantes if cluster != cluster_reciente_bajo
    )

    nombres = {
        cluster_inactivo: "Sin compras registradas",
        cluster_reciente_bajo: "Recientes de consumo bajo",
        cluster_ocasional: "Clientes ocasionales por reactivar",
        cluster_alto_valor: "Frecuentes de alto valor",
    }
    acciones = {
        cluster_inactivo: (
            "Campaña de activación o bienvenida y medición de la primera compra."
        ),
        cluster_reciente_bajo: (
            "Seguimiento posterior a la compra y promoción para una segunda visita."
        ),
        cluster_ocasional: (
            "Recordatorios digitales, productos complementarios y reactivación "
            "por recencia."
        ),
        cluster_alto_valor: (
            "Programa de fidelidad, beneficios exclusivos y recomendaciones "
            "personalizadas."
        ),
    }
    return nombres, acciones, perfil_promedio


def lista_numerica(valores) -> list[float]:
    return [float(valor) for valor in np.asarray(valores).tolist()]


def exportar_runtime(
    pipeline: Pipeline,
    nombres: dict[int, str],
    acciones: dict[int, str],
    perfil_promedio: pd.DataFrame,
    metricas: dict[str, float],
    fecha_corte: pd.Timestamp,
    recencia_sin_compra: float,
    filas: int,
    dataset: Path,
) -> dict:
    preprocesador = pipeline.named_steps["preprocesamiento"]
    sesgadas = preprocesador.named_transformers_["variables_sesgadas"]
    proporcion = preprocesador.named_transformers_["proporcion"]
    modelo = pipeline.named_steps["modelo"]

    imputer_sesgadas = sesgadas.named_steps["imputacion"]
    scaler_sesgadas = sesgadas.named_steps["escalado"]
    imputer_proporcion = proporcion.named_steps["imputacion"]
    scaler_proporcion = proporcion.named_steps["escalado"]

    return {
        "version_esquema": 1,
        "nombre": "Segmentación de patrones de compra Miru Franco",
        "modelo": "K-Means",
        "origen": "MIRUFRANCO_Clustering_COMPLETA_CORREGIDA",
        "random_state": RANDOM_STATE,
        "filas_entrenamiento": filas,
        "version_sklearn": sklearn.__version__,
        "dataset_fuente": dataset.name,
        "fecha_corte": fecha_corte.isoformat(),
        "recencia_sin_compra": recencia_sin_compra,
        "features": FEATURES,
        "orden_transformado": FEATURES_SESGADAS + FEATURES_ACOTADAS,
        "preprocesamiento": {
            "sesgadas": {
                "features": FEATURES_SESGADAS,
                "imputacion": lista_numerica(imputer_sesgadas.statistics_),
                "transformacion": "log1p",
                "media": lista_numerica(scaler_sesgadas.mean_),
                "escala": lista_numerica(scaler_sesgadas.scale_),
            },
            "acotadas": {
                "features": FEATURES_ACOTADAS,
                "imputacion": lista_numerica(imputer_proporcion.statistics_),
                "media": lista_numerica(scaler_proporcion.mean_),
                "escala": lista_numerica(scaler_proporcion.scale_),
            },
        },
        "kmeans": {
            "numero_clusters": K_FINAL,
            "centroides": [
                lista_numerica(centro) for centro in modelo.cluster_centers_
            ],
        },
        "nombres_segmentos": {
            str(cluster): nombre for cluster, nombre in nombres.items()
        },
        "acciones_segmentos": {
            str(cluster): accion for cluster, accion in acciones.items()
        },
        "perfil_promedio": {
            str(int(cluster)): {
                feature: float(valor)
                for feature, valor in fila.items()
            }
            for cluster, fila in perfil_promedio.iterrows()
        },
        "metricas": metricas,
    }


def predecir_con_runtime(runtime: dict, X: pd.DataFrame) -> np.ndarray:
    """Verifica que el JSON reproduzca la inferencia sin usar el pipeline."""
    columnas_transformadas: list[np.ndarray] = []
    for nombre_grupo in ["sesgadas", "acotadas"]:
        grupo = runtime["preprocesamiento"][nombre_grupo]
        for indice, feature in enumerate(grupo["features"]):
            valores = pd.to_numeric(X[feature], errors="coerce").to_numpy(
                dtype=float
            )
            valores = np.where(
                np.isfinite(valores),
                valores,
                grupo["imputacion"][indice],
            )
            if grupo.get("transformacion") == "log1p":
                valores = np.log1p(np.maximum(valores, 0))
            escala = grupo["escala"][indice] or 1.0
            columnas_transformadas.append(
                (valores - grupo["media"][indice]) / escala
            )

    matriz = np.column_stack(columnas_transformadas)
    centroides = np.asarray(runtime["kmeans"]["centroides"], dtype=float)
    distancias = ((matriz[:, None, :] - centroides[None, :, :]) ** 2).sum(
        axis=2
    )
    return distancias.argmin(axis=1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("src/clientes/model"),
    )
    args = parser.parse_args()

    if not args.dataset.is_file():
        raise FileNotFoundError(f"No se encontró el dataset: {args.dataset}")

    df, X, fecha_corte, recencia_sin_compra = preparar_datos(args.dataset)
    pipeline = Pipeline(
        steps=[
            ("preprocesamiento", construir_preprocesador()),
            (
                "modelo",
                KMeans(
                    n_clusters=K_FINAL,
                    random_state=RANDOM_STATE,
                    n_init=30,
                ),
            ),
        ]
    )
    df["cluster"] = pipeline.fit_predict(X)
    X_transformado = pipeline.named_steps["preprocesamiento"].transform(X)
    etiquetas = df["cluster"].to_numpy()

    metricas = {
        "k": K_FINAL,
        "silhouette": float(silhouette_score(X_transformado, etiquetas)),
        "davies_bouldin": float(
            davies_bouldin_score(X_transformado, etiquetas)
        ),
        "calinski_harabasz": float(
            calinski_harabasz_score(X_transformado, etiquetas)
        ),
        "inercia": float(pipeline.named_steps["modelo"].inertia_),
    }
    nombres, acciones, perfil_promedio = definir_segmentos(df)

    artefacto = {
        "pipeline": pipeline,
        "features": FEATURES,
        "fecha_corte": fecha_corte.isoformat(),
        "recencia_sin_compra": recencia_sin_compra,
        "nombres_segmentos": nombres,
        "acciones_segmentos": acciones,
        "metricas": metricas,
        "perfil_promedio": perfil_promedio.round(4),
        "dataset_fuente": args.dataset.name,
        "random_state": RANDOM_STATE,
        "versiones": {
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
    }
    runtime = exportar_runtime(
        pipeline=pipeline,
        nombres=nombres,
        acciones=acciones,
        perfil_promedio=perfil_promedio,
        metricas=metricas,
        fecha_corte=fecha_corte,
        recencia_sin_compra=recencia_sin_compra,
        filas=len(df),
        dataset=args.dataset,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    ruta_joblib = args.output_dir / "clustering_patrones_compra.joblib"
    ruta_runtime = (
        args.output_dir / "clustering_patrones_compra.model.json"
    )
    ruta_metadata = (
        args.output_dir / "clustering_patrones_compra.metadata.json"
    )

    joblib.dump(artefacto, ruta_joblib)
    ruta_runtime.write_text(
        json.dumps(runtime, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    metadata = {
        "nombre": runtime["nombre"],
        "modelo": runtime["modelo"],
        "filas_entrenamiento": len(df),
        "fecha_corte": runtime["fecha_corte"],
        "recencia_sin_compra": recencia_sin_compra,
        "features": FEATURES,
        "metricas": metricas,
        "segmentos": [
            {
                "cluster": cluster,
                "nombre": nombres[cluster],
                "accion_sugerida": acciones[cluster],
                "clientes_entrenamiento": int(
                    (df["cluster"] == cluster).sum()
                ),
            }
            for cluster in sorted(nombres)
        ],
    }
    ruta_metadata.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    pred_joblib = joblib.load(ruta_joblib)["pipeline"].predict(X)
    if not np.array_equal(pred_joblib, etiquetas):
        raise RuntimeError("El joblib recargado no reproduce las asignaciones.")
    pred_runtime = predecir_con_runtime(runtime, X)
    if not np.array_equal(pred_runtime, etiquetas):
        diferentes = int(np.count_nonzero(pred_runtime != etiquetas))
        raise RuntimeError(
            f"El JSON de producción difiere en {diferentes} asignaciones."
        )

    print(f"Clientes entrenados: {len(df):,}")
    print(f"Segmentos: {df['cluster'].value_counts().sort_index().to_dict()}")
    print(
        "Métricas: "
        f"Silhouette={metricas['silhouette']:.4f}, "
        f"Davies-Bouldin={metricas['davies_bouldin']:.4f}, "
        f"Calinski-Harabasz={metricas['calinski_harabasz']:.2f}"
    )
    print(f"Joblib: {ruta_joblib}")
    print(f"Runtime NestJS: {ruta_runtime}")
    print(f"Metadatos: {ruta_metadata}")
    print("Verificación: joblib y JSON reproducen las 1,017 asignaciones.")


if __name__ == "__main__":
    main()
