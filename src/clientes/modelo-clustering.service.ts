import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface VariablesClusteringCliente {
  frecuencia_total: number;
  productos_totales: number;
  servicios_comprados: number;
  gasto_total: number;
  ticket_promedio: number;
  proporcion_online: number;
  recencia_dias: number;
}

interface GrupoPreprocesamiento {
  features: (keyof VariablesClusteringCliente)[];
  imputacion: number[];
  media: number[];
  escala: number[];
  transformacion?: 'log1p';
}

interface ArtefactoClustering {
  version_esquema: number;
  nombre: string;
  modelo: string;
  origen: string;
  random_state: number;
  filas_entrenamiento: number;
  version_sklearn: string;
  dataset_fuente: string;
  fecha_corte: string;
  recencia_sin_compra: number;
  features: (keyof VariablesClusteringCliente)[];
  orden_transformado: (keyof VariablesClusteringCliente)[];
  preprocesamiento: {
    sesgadas: GrupoPreprocesamiento;
    acotadas: GrupoPreprocesamiento;
  };
  kmeans: {
    numero_clusters: number;
    centroides: number[][];
  };
  nombres_segmentos: Record<string, string>;
  acciones_segmentos: Record<string, string>;
  metricas: {
    k: number;
    silhouette: number;
    davies_bouldin: number;
    calinski_harabasz: number;
    inercia: number;
  };
}

export interface ResultadoModeloClustering {
  cluster: number;
  segmento: string;
  accionSugerida: string;
  distanciaCentroide: number;
  variables: VariablesClusteringCliente;
  modelo: {
    nombre: string;
    algoritmo: string;
    filasEntrenamiento: number;
    fechaCorte: string;
    silhouette: number;
  };
}

const ARCHIVO_MODELO = 'clustering_patrones_compra.model.json';

@Injectable()
export class ModeloClusteringService implements OnModuleInit {
  private readonly logger = new Logger(ModeloClusteringService.name);
  private artefacto: ArtefactoClustering | null = null;

  onModuleInit() {
    this.cargarModelo();
  }

  obtenerRecenciaSinCompra(): number {
    return this.cargarModelo().recencia_sin_compra;
  }

  obtenerInformacionModelo(): ResultadoModeloClustering['modelo'] {
    const artefacto = this.cargarModelo();
    return {
      nombre: artefacto.nombre,
      algoritmo: artefacto.modelo,
      filasEntrenamiento: artefacto.filas_entrenamiento,
      fechaCorte: artefacto.fecha_corte,
      silhouette: Number(artefacto.metricas.silhouette.toFixed(4)),
    };
  }

  predecir(
    variables: VariablesClusteringCliente,
  ): ResultadoModeloClustering {
    const artefacto = this.cargarModelo();
    const vector = [
      ...this.transformarGrupo(
        variables,
        artefacto.preprocesamiento.sesgadas,
      ),
      ...this.transformarGrupo(
        variables,
        artefacto.preprocesamiento.acotadas,
      ),
    ];

    let cluster = -1;
    let distanciaMinima = Number.POSITIVE_INFINITY;
    artefacto.kmeans.centroides.forEach((centroide, indice) => {
      const distanciaCuadrada = centroide.reduce((acumulado, valor, posicion) => {
        const diferencia = vector[posicion] - valor;
        return acumulado + diferencia * diferencia;
      }, 0);
      if (distanciaCuadrada < distanciaMinima) {
        distanciaMinima = distanciaCuadrada;
        cluster = indice;
      }
    });

    const segmento = artefacto.nombres_segmentos[String(cluster)];
    const accionSugerida = artefacto.acciones_segmentos[String(cluster)];
    if (!segmento || !accionSugerida) {
      throw new InternalServerErrorException(
        'El modelo devolvió un segmento sin descripción.',
      );
    }

    return {
      cluster,
      segmento,
      accionSugerida,
      distanciaCentroide: Number(Math.sqrt(distanciaMinima).toFixed(4)),
      variables,
      modelo: this.obtenerInformacionModelo(),
    };
  }

  private transformarGrupo(
    variables: VariablesClusteringCliente,
    grupo: GrupoPreprocesamiento,
  ): number[] {
    return grupo.features.map((feature, indice) => {
      const valorCrudo = Number(variables[feature]);
      const imputado = Number.isFinite(valorCrudo)
        ? valorCrudo
        : grupo.imputacion[indice];
      const transformado =
        grupo.transformacion === 'log1p'
          ? Math.log1p(Math.max(0, imputado))
          : imputado;
      const escala = grupo.escala[indice] || 1;
      return (transformado - grupo.media[indice]) / escala;
    });
  }

  private cargarModelo(): ArtefactoClustering {
    if (this.artefacto) return this.artefacto;

    const candidatos = [
      resolve(process.cwd(), 'src', 'clientes', 'model', ARCHIVO_MODELO),
      resolve(__dirname, 'model', ARCHIVO_MODELO),
      resolve(__dirname, '..', '..', 'src', 'clientes', 'model', ARCHIVO_MODELO),
    ];
    const ruta = candidatos.find((candidato) => existsSync(candidato));
    if (!ruta) {
      throw new InternalServerErrorException(
        'No se encontró el artefacto de segmentación de clientes.',
      );
    }

    try {
      const artefacto = JSON.parse(
        readFileSync(ruta, 'utf8'),
      ) as ArtefactoClustering;
      this.validarArtefacto(artefacto);
      this.artefacto = artefacto;
      this.logger.log(
        `Modelo ${artefacto.modelo} cargado (${artefacto.kmeans.numero_clusters} segmentos, ${artefacto.filas_entrenamiento} clientes)`,
      );
      return artefacto;
    } catch (error) {
      const detalle = error instanceof Error ? error.message : 'error desconocido';
      this.logger.error(`No fue posible cargar el clustering: ${detalle}`);
      throw new InternalServerErrorException(
        'El modelo de segmentación de clientes no está disponible.',
      );
    }
  }

  private validarArtefacto(artefacto: ArtefactoClustering) {
    const dimension = artefacto?.orden_transformado?.length;
    const centroides = artefacto?.kmeans?.centroides;
    if (
      artefacto?.version_esquema !== 1 ||
      !Array.isArray(artefacto.features) ||
      artefacto.features.length !== 7 ||
      !Array.isArray(centroides) ||
      centroides.length !== artefacto.kmeans.numero_clusters ||
      centroides.some(
        (centroide) =>
          !Array.isArray(centroide) ||
          centroide.length !== dimension ||
          centroide.some((valor) => !Number.isFinite(valor)),
      )
    ) {
      throw new Error('Artefacto de clustering inválido o incompatible.');
    }
  }
}
