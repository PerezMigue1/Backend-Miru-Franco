import tracer from 'dd-trace';

// Inicializa Datadog APM/AppSec/IAST temprano en el ciclo de arranque.
// Las capacidades se controlan por variables de entorno (DD_*).
tracer.init({
  service: process.env.DD_SERVICE || 'backend-miru',
  env: process.env.DD_ENV || process.env.NODE_ENV || 'development',
  version: process.env.DD_VERSION || process.env.npm_package_version || '1.0.0',
  logInjection: true,
  // Igual que el asistente de Datadog: activa AppSec en el tracer
  appsec: true,
  iast: true,
});

export default tracer;
