import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { gunzipSync } from 'zlib';

type ValorEntrada = string | number | boolean | null | undefined;
export type RegistroModeloCancelacion = Record<string, ValorEntrada>;

interface ReglaNumerica {
  nombre: string;
  imputacion: number;
  media: number;
  escala: number;
}

interface ReglaCategorica {
  nombre: string;
  imputacion: string;
  categorias: string[];
}

interface ArbolSerializado {
  izquierda: number[];
  derecha: number[];
  variable: number[];
  umbral: number[];
  probabilidad_clase_1: number[];
}

interface ArtefactoModelo {
  version_esquema: number;
  nombre: string;
  modelo: string;
  origen: string;
  random_state: number;
  filas_entrenamiento: number;
  version_sklearn: string;
  features: string[];
  preprocesamiento: {
    numericas: ReglaNumerica[];
    categoricas: ReglaCategorica[];
  };
  bosque: {
    numero_clases: number;
    numero_arboles: number;
    arboles: ArbolSerializado[];
  };
  umbral: number;
  umbrales_riesgo: {
    medio: number;
    alto: number;
  };
}

export type NivelRiesgoCancelacion = 'bajo' | 'medio' | 'alto';

export interface ResultadoModeloCancelacion {
  probabilidadCancelacion: number;
  porcentajeCancelacion: number;
  prediccionCancelada: boolean;
  prediccion: 'cancelada' | 'no_cancelada';
  nivelRiesgo: NivelRiesgoCancelacion;
  accionSugerida: string;
  modelo: {
    nombre: string;
    algoritmo: string;
    umbral: number;
    filasEntrenamiento: number;
  };
}

const ARCHIVO_MODELO = 'clasificacion_cancelacion_citas.model.json.gz';

@Injectable()
export class ModeloCancelacionService implements OnModuleInit {
  private readonly logger = new Logger(ModeloCancelacionService.name);
  private artefacto: ArtefactoModelo | null = null;

  onModuleInit() {
    this.cargarModelo();
  }

  private cargarModelo(): ArtefactoModelo {
    if (this.artefacto) return this.artefacto;

    const candidatos = [
      resolve(process.cwd(), 'src', 'citas', 'model', ARCHIVO_MODELO),
      resolve(__dirname, 'model', ARCHIVO_MODELO),
      resolve(__dirname, '..', '..', 'src', 'citas', 'model', ARCHIVO_MODELO),
    ];
    const ruta = candidatos.find((candidato) => existsSync(candidato));
    if (!ruta) {
      throw new InternalServerErrorException(
        'No se encontró el artefacto del modelo de cancelación de citas.',
      );
    }

    try {
      const contenido = gunzipSync(readFileSync(ruta)).toString('utf8');
      const artefacto = JSON.parse(contenido) as ArtefactoModelo;
      this.validarArtefacto(artefacto);
      this.artefacto = artefacto;
      this.logger.log(
        `Modelo ${artefacto.modelo} cargado (${artefacto.bosque.numero_arboles} árboles, ${artefacto.filas_entrenamiento} citas)`,
      );
      return artefacto;
    } catch (error) {
      const detalle = error instanceof Error ? error.message : 'error desconocido';
      this.logger.error(`No fue posible cargar el modelo: ${detalle}`);
      throw new InternalServerErrorException(
        'El modelo de cancelación de citas no está disponible.',
      );
    }
  }

  private validarArtefacto(artefacto: ArtefactoModelo) {
    if (
      artefacto?.version_esquema !== 1 ||
      !Array.isArray(artefacto.features) ||
      !Array.isArray(artefacto.bosque?.arboles) ||
      artefacto.bosque.arboles.length !== artefacto.bosque.numero_arboles ||
      artefacto.bosque.numero_arboles < 1 ||
      !Number.isFinite(artefacto.umbral)
    ) {
      throw new Error('Artefacto de modelo inválido o incompatible.');
    }
  }

  private transformar(
    registro: RegistroModeloCancelacion,
    artefacto: ArtefactoModelo,
  ): number[] {
    const vector: number[] = [];

    for (const regla of artefacto.preprocesamiento.numericas) {
      const valorCrudo = Number(registro[regla.nombre]);
      const valor = Number.isFinite(valorCrudo) ? valorCrudo : regla.imputacion;
      const escala = regla.escala || 1;
      // scikit-learn evalúa los árboles con entradas float32.
      vector.push(Math.fround((valor - regla.media) / escala));
    }

    for (const regla of artefacto.preprocesamiento.categoricas) {
      const valorCrudo = registro[regla.nombre];
      const valor =
        valorCrudo === null || valorCrudo === undefined || valorCrudo === ''
          ? regla.imputacion
          : String(valorCrudo);
      for (const categoria of regla.categorias) {
        vector.push(valor === categoria ? 1 : 0);
      }
    }

    return vector;
  }

  private probabilidadBosque(vector: number[], artefacto: ArtefactoModelo): number {
    let acumulado = 0;

    for (const arbol of artefacto.bosque.arboles) {
      let nodo = 0;
      let pasos = 0;

      while (arbol.variable[nodo] >= 0) {
        const indiceVariable = arbol.variable[nodo];
        if (indiceVariable >= vector.length || pasos++ > arbol.variable.length) {
          throw new InternalServerErrorException(
            'El artefacto del modelo contiene un árbol inválido.',
          );
        }
        nodo =
          vector[indiceVariable] <= arbol.umbral[nodo]
            ? arbol.izquierda[nodo]
            : arbol.derecha[nodo];
      }

      acumulado += arbol.probabilidad_clase_1[nodo];
    }

    return acumulado / artefacto.bosque.numero_arboles;
  }

  predecir(registro: RegistroModeloCancelacion): ResultadoModeloCancelacion {
    const artefacto = this.cargarModelo();
    const vector = this.transformar(registro, artefacto);
    const probabilidad = this.probabilidadBosque(vector, artefacto);
    const prediccionCancelada = probabilidad >= artefacto.umbral;

    let nivelRiesgo: NivelRiesgoCancelacion;
    let accionSugerida: string;
    if (probabilidad < artefacto.umbrales_riesgo.medio) {
      nivelRiesgo = 'bajo';
      accionSugerida = 'Enviar el recordatorio normal de la cita.';
    } else if (probabilidad < artefacto.umbrales_riesgo.alto) {
      nivelRiesgo = 'medio';
      accionSugerida = 'Enviar recordatorio y solicitar confirmación.';
    } else {
      nivelRiesgo = 'alto';
      accionSugerida = 'Realizar confirmación prioritaria por el personal.';
    }

    return {
      probabilidadCancelacion: Number(probabilidad.toFixed(4)),
      porcentajeCancelacion: Number((probabilidad * 100).toFixed(1)),
      prediccionCancelada,
      prediccion: prediccionCancelada ? 'cancelada' : 'no_cancelada',
      nivelRiesgo,
      accionSugerida,
      modelo: {
        nombre: artefacto.nombre,
        algoritmo: artefacto.modelo,
        umbral: artefacto.umbral,
        filasEntrenamiento: artefacto.filas_entrenamiento,
      },
    };
  }
}
