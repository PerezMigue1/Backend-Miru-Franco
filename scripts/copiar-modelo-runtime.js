const { copyFileSync, existsSync, mkdirSync } = require('fs');
const { resolve } = require('path');

const artefactos = [
  {
    nombre: 'clasificacion_cancelacion_citas.model.json.gz',
    modulo: 'citas',
  },
  {
    nombre: 'clustering_patrones_compra.model.json',
    modulo: 'clientes',
  },
];

for (const artefacto of artefactos) {
  const origen = resolve(
    process.cwd(),
    'src',
    artefacto.modulo,
    'model',
    artefacto.nombre,
  );
  const directorioDestino = resolve(
    process.cwd(),
    'dist',
    artefacto.modulo,
    'model',
  );
  const destino = resolve(directorioDestino, artefacto.nombre);

  if (!existsSync(origen)) {
    throw new Error(`No se encontró el artefacto requerido: ${origen}`);
  }

  mkdirSync(directorioDestino, { recursive: true });
  copyFileSync(origen, destino);
  console.log(`Artefacto del modelo copiado a ${destino}`);
}
