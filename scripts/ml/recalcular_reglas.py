"""
recalcular_reglas.py
--------------------------------------------------------------------
Recalcula las reglas de asociacion (Apriori) para el recomendador de
Miru Franco, y reemplaza la tabla `reglas_asociacion` en Neon de forma
segura. Pensado para correr automaticamente via GitHub Actions
(.github/workflows/recalcular-reglas.yml), pero tambien se puede
correr a mano:

    DATABASE_URL="postgresql://..." python scripts/ml/recalcular_reglas.py

Diseño (por que esta version es distinta del script del paso 1):
  - El CATALOGO (servicios y productos) se lee en vivo de Neon en cada
    corrida -- nunca hay una lista fija en el codigo. Si se agregan
    productos o servicios nuevos, la siguiente corrida ya los conoce
    solos, sin tocar este archivo.
  - Las TRANSACCIONES se leen de datos reales (ventas_local +
    ventas_local_items) cuando hay suficiente volumen
    (MIN_TRANSACCIONES_REALES). Mientras el negocio no tenga ese
    volumen, se completa con transacciones simuladas genericas sobre
    el catalogo real (sin afinidad de marca curada a mano -- esa
    curaduria fue util para la demo academica del paso 1, pero aqui
    el objetivo es que la simulacion sea puramente un "arranque en
    frio" que se descarta sola en cuanto hay datos reales de sobra).
  - Antes de reemplazar la tabla en Neon, se valida que el resultado
    sea razonable (no vacio, no muy por debajo de lo que ya habia).
    Si no pasa la validacion, NO se toca la tabla y el job termina
    con error (para que se note en GitHub Actions).
  - El reemplazo es atomico (una transaccion SQL: borra e inserta, o
    no hace nada si algo falla a la mitad).
--------------------------------------------------------------------
"""

import os
import random
import sys
from datetime import datetime

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from mlxtend.preprocessing import TransactionEncoder
from mlxtend.frequent_patterns import apriori, association_rules

# ============================================================
# CONFIGURACION
# (revisar min_support cuando el volumen de datos cambie de orden de
#  magnitud -- con mas transacciones y catalogo mas disperso, el
#  soporte de cada item individual baja, igual que nos paso al pasar
#  de canastas por cliente a canastas por visita en el proyecto original).
# ============================================================
MIN_SUPPORT = float(os.environ.get("RECOMENDADOR_MIN_SUPPORT", "0.01"))
MIN_CONFIDENCE_ALTA = 0.5
MIN_CONFIDENCE_AMPLIA = 0.10
VENTANA_DIAS = int(os.environ.get("RECOMENDADOR_VENTANA_DIAS", "365"))
MIN_TRANSACCIONES_REALES = int(os.environ.get("RECOMENDADOR_MIN_TRANSACCIONES_REALES", "200"))
N_TRANSACCIONES_SIMULADAS = 4000
N_PRODUCTOS_POR_DEPARTAMENTO = int(os.environ.get("RECOMENDADOR_N_PRODUCTOS_POR_DEPTO", "6"))
MIN_REGLAS_ACEPTABLE = 15
PROPORCION_MINIMA_VS_ACTUAL = 0.2  # no reemplazar si el resultado nuevo es <20% del actual

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: falta la variable de entorno DATABASE_URL", file=sys.stderr)
    sys.exit(1)


def log(msg):
    print(f"[{datetime.utcnow().isoformat()}Z] {msg}", flush=True)


def conectar():
    return psycopg2.connect(DATABASE_URL)


# ============================================================
# 1. CATALOGO REAL (leido en vivo, nunca hardcodeado)
# ============================================================
def cargar_catalogo(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, nombre, categoria FROM servicios WHERE activo = true ORDER BY id")
        servicios = cur.fetchall()

        # ORDER BY creado_en ASC: necesario para poder curar un subconjunto
        # ESTABLE por departamento (los productos más antiguos/establecidos
        # primero) en generar_transacciones_simuladas(). Sin un orden fijo,
        # random.choice()/random.sample() con semilla fija dejan de ser
        # reproducibles entre corridas (el orden de un SELECT sin ORDER BY
        # no está garantizado por Postgres).
        cur.execute("""
            SELECT p.id, p.nombre, p.marca, p.categoria
            FROM productos p
            WHERE EXISTS (
                SELECT 1 FROM producto_presentaciones pp
                WHERE pp.producto_id = p.id AND pp.disponible = true
            )
            ORDER BY p.creado_en ASC
        """)
        productos = cur.fetchall()

    log(f"Catálogo real: {len(servicios)} servicios activos, {len(productos)} productos disponibles")
    return servicios, productos


# ============================================================
# 2. TRANSACCIONES REALES
#    Una transacción = una venta (ventas_local), sus ítems son los
#    servicios/productos de ventas_local_items en esa misma venta.
# ============================================================
def cargar_transacciones_reales(conn, dias=VENTANA_DIAS):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT vli.venta_id,
                   COALESCE(s.nombre, pr.nombre) AS item_nombre
            FROM ventas_local_items vli
            JOIN ventas_local vl ON vl.id = vli.venta_id
            LEFT JOIN servicios s ON s.id = vli.servicio_id
            LEFT JOIN producto_presentaciones pp ON pp.id = vli.presentacion_id
            LEFT JOIN productos pr ON pr.id = pp.producto_id
            WHERE vl.creado_en >= now() - (%s || ' days')::interval
              AND vl.estado != 'cancelada'
            """,
            (dias,),
        )
        filas = cur.fetchall()

    canastas = {}
    for venta_id, nombre in filas:
        if not nombre:
            continue
        canastas.setdefault(venta_id, set()).add(nombre)

    transacciones = [list(items) for items in canastas.values() if items]
    log(f"Transacciones reales encontradas (últimos {dias} días): {len(transacciones)}")
    return transacciones


# ============================================================
# 3. TRANSACCIONES SIMULADAS DE ARRANQUE EN FRÍO
# ============================================================
# Mapeo marca -> departamento. Es la ÚNICA lista curada a mano en todo el
# script, y es deliberadamente pequeña y estable: una marca nueva es un
# evento de negocio poco frecuente (a diferencia de un SKU nuevo, que puede
# pasar cada semana). Los productos NO se listan aquí -- se leen en vivo
# del catálogo real, agrupados por esta marca. Si se prueba con simulación
# 100% aleatoria (sin esta estructura), Apriori no encuentra ningún patrón
# -- se validó al construir este script -- así que este mapeo es necesario
# para que la simulación de arranque en frío tenga algo de qué "aprender".
MARCA_A_DEPARTAMENTO = {
    "AVYNA": "capilar", "TEC ITALY": "capilar", "LECLAT": "capilar", "NBC": "capilar",
    "CHOCOLATTO": "capilar", "NEURONE": "capilar", "ISSEDA": "capilar",
    "MAYBELLINE": "maquillaje", "MARY KAY": "maquillaje", "JAFRA": "maquillaje",
    "YUYA": "maquillaje", "BISSU": "maquillaje",
    "GARNIER": "facial", "NIVEA": "facial", "SHELÓ": "facial",
}

CATEGORIA_SERVICIO_A_DEPARTAMENTO = {
    "Alaciados y Alisados": "capilar",
    "Tratamientos Capilares": "capilar",
    "Estilismo y Belleza": "capilar",
    "Estética": "maquillaje",
    "Depilación": "facial",
}


def generar_transacciones_simuladas(servicios, productos, n=N_TRANSACCIONES_SIMULADAS):
    """
    Simulación de arranque en frío. Agrupa el catálogo real por
    departamento (via categoría de servicio / marca de producto, ambos
    leídos en vivo) y simula visitas donde el producto sugerido pertenece
    al mismo departamento que el servicio elegido -- sin nombrar ni un
    solo producto o servicio específico en el código. En cuanto haya
    suficientes transacciones reales, esta función deja de usarse.
    """
    random.seed(42)

    # Cura un subconjunto pequeño y ESTABLE por departamento (los más
    # antiguos primero, gracias al ORDER BY creado_en de cargar_catalogo).
    # Esto es lo que hace posible que la simulación de arranque en frío
    # genere reglas con confianza suficiente: con 62-94 productos
    # compitiendo por "qué acompaña a este servicio", ningún producto
    # individual concentra suficiente probabilidad (se valida al construir
    # este script -- ver notas en el repositorio). Con un subconjunto de
    # ~8 por departamento, cada uno se lleva una porción representativa,
    # igual que en la curaduría manual del demo académico original, pero
    # elegida automáticamente y actualizable sola (si un producto
    # "destacado" se desactiva, el siguiente más antiguo ocupa su lugar
    # en la próxima corrida).
    pool_por_depto = {}
    for (_id, nombre, marca, _categoria) in productos:
        depto = MARCA_A_DEPARTAMENTO.get((marca or "").upper())
        if not depto:
            continue
        lista = pool_por_depto.setdefault(depto, [])
        if len(lista) < N_PRODUCTOS_POR_DEPARTAMENTO:
            lista.append(nombre)

    servicios_con_depto = [
        (nombre, CATEGORIA_SERVICIO_A_DEPARTAMENTO.get(categoria))
        for (_id, nombre, categoria) in servicios
    ]
    servicios_con_depto = [(n, d) for (n, d) in servicios_con_depto if d]

    if not servicios_con_depto:
        return []

    transacciones = []
    for _ in range(n):
        # ~30% de las visitas simuladas son compra de producto sola, sin
        # servicio de por medio (igual que un carrito real de la tienda
        # online) -- esto le da señal a departamentos completos que no
        # tienen NINGÚN servicio activo asociado (ej. maquillaje, si
        # "Maquillaje y Peinado" está desactivado). Sin este caso, esos
        # productos jamás aparecerían en ninguna transacción simulada.
        #
        # NOTA IMPORTANTE: si un departamento tiene un catálogo muy
        # grande (decenas de SKUs) y NINGÚN servicio activo lo respalda,
        # ninguna cantidad de transacciones simuladas le dará soporte
        # suficiente a cada producto individual (el soporte es un
        # porcentaje, no una cuenta absoluta -- crece con el total).
        # Eso no es un bug: significa que ese departamento necesita
        # historial de ventas REAL para generar recomendaciones
        # confiables, o que vale la pena revisar si el servicio
        # relacionado debería estar activo.
        if random.random() < 0.30 and pool_por_depto:
            depto = random.choice(list(pool_por_depto.keys()))
            pool = pool_por_depto[depto]
            k = min(random.randint(2, 3), len(pool))
            if k >= 2:
                transacciones.append(random.sample(pool, k))
                continue

        nombre_servicio, depto = random.choice(servicios_con_depto)
        canasta = {nombre_servicio}
        pool = pool_por_depto.get(depto, [])
        if pool and random.random() < 0.75:
            k = min(random.randint(1, 3), len(pool))
            canasta.update(random.sample(pool, k))
        transacciones.append(list(canasta))

    log(f"Transacciones simuladas de arranque en frío generadas: {len(transacciones)}")
    return transacciones


# ============================================================
# 4. APRIORI
# ============================================================
def calcular_reglas(transacciones):
    te = TransactionEncoder()
    matriz = te.fit(transacciones).transform(transacciones)
    df = pd.DataFrame(matriz, columns=te.columns_)

    frecuentes = apriori(df, min_support=MIN_SUPPORT, use_colnames=True)
    if frecuentes.empty:
        return pd.DataFrame(columns=["antecedente", "consecuente", "soporte", "confianza", "lift", "tipo"])

    reglas_altas = association_rules(frecuentes, metric="confidence", min_threshold=MIN_CONFIDENCE_ALTA)
    reglas_altas = reglas_altas[reglas_altas["lift"] > 1].copy()
    reglas_altas["tipo"] = "alta_confianza"

    reglas_amplias = association_rules(frecuentes, metric="confidence", min_threshold=MIN_CONFIDENCE_AMPLIA)
    reglas_amplias = reglas_amplias[reglas_amplias["lift"] > 1].copy()
    reglas_amplias["tipo"] = "confianza_amplia"

    todas = pd.concat([reglas_altas, reglas_amplias]).drop_duplicates(subset=["antecedents", "consequents"])
    todas = todas[todas["antecedents"].apply(len) == 1]  # antecedentes de un solo ítem, igual que el diseño original
    todas = todas[todas["consequents"].apply(len) == 1]

    resultado = pd.DataFrame({
        "antecedente": todas["antecedents"].apply(lambda x: next(iter(x))),
        "consecuente": todas["consequents"].apply(lambda x: next(iter(x))),
        "soporte": todas["support"].round(4),
        "confianza": todas["confidence"].round(4),
        "lift": todas["lift"].round(4),
        "tipo": todas["tipo"],
    })
    return resultado.sort_values("lift", ascending=False).reset_index(drop=True)


# ============================================================
# 5. VALIDACIÓN DE SEGURIDAD ANTES DE REEMPLAZAR
# ============================================================
def reglas_son_razonables(nuevas_df, conn):
    n_nuevas = len(nuevas_df)
    if n_nuevas < MIN_REGLAS_ACEPTABLE:
        return False, f"Solo se generaron {n_nuevas} reglas (mínimo aceptable: {MIN_REGLAS_ACEPTABLE})"

    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM reglas_asociacion")
        n_actuales = cur.fetchone()[0]

    if n_actuales > 0 and n_nuevas < n_actuales * PROPORCION_MINIMA_VS_ACTUAL:
        return False, (
            f"Las reglas nuevas ({n_nuevas}) son menos del "
            f"{int(PROPORCION_MINIMA_VS_ACTUAL * 100)}% de las actuales ({n_actuales}) — "
            "posible problema de datos, no se reemplaza."
        )

    return True, f"OK ({n_nuevas} reglas nuevas vs. {n_actuales} actuales)"


# ============================================================
# 6. REEMPLAZO ATÓMICO
# ============================================================
def reemplazar_reglas(conn, reglas_df, origen):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM reglas_asociacion")
        filas = [
            (r.antecedente, r.consecuente, float(r.soporte), float(r.confianza), float(r.lift), r.tipo, origen)
            for r in reglas_df.itertuples()
        ]
        execute_values(
            cur,
            """
            INSERT INTO reglas_asociacion
                (antecedente, consecuente, soporte, confianza, lift, tipo, origen)
            VALUES %s
            """,
            filas,
        )
    conn.commit()


# ============================================================
# MAIN
# ============================================================
def main():
    conn = conectar()
    try:
        servicios, productos = cargar_catalogo(conn)
        transacciones_reales = cargar_transacciones_reales(conn)

        if len(transacciones_reales) >= MIN_TRANSACCIONES_REALES:
            transacciones = transacciones_reales
            origen = "real"
            log("Volumen real suficiente: se usa SOLO historial real (sin simulación).")
        else:
            simuladas = generar_transacciones_simuladas(servicios, productos)
            transacciones = transacciones_reales + simuladas
            origen = "simulado"
            log(
                f"Volumen real insuficiente ({len(transacciones_reales)} < {MIN_TRANSACCIONES_REALES}): "
                "se completa con simulación de arranque en frío."
            )

        if not transacciones:
            log("No hay transacciones (ni reales ni simuladas) — no se puede calcular nada. Abortando.")
            sys.exit(1)

        reglas_df = calcular_reglas(transacciones)
        log(f"min_support usado: {MIN_SUPPORT} — reglas calculadas: {len(reglas_df)}")

        ok, motivo = reglas_son_razonables(reglas_df, conn)
        log(f"Validación de seguridad: {motivo}")
        if not ok:
            log("NO se reemplaza la tabla reglas_asociacion. Revisa los datos de origen.")
            sys.exit(1)

        reemplazar_reglas(conn, reglas_df, origen)
        log(f"reglas_asociacion reemplazada con éxito: {len(reglas_df)} reglas (origen={origen}).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
