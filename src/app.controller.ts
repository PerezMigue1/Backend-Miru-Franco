import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return {
      message: 'Miru Franco Backend API',
      version: '1.0.0',
      status: 'running',
      documentation: 'https://github.com/PerezMigue1/Backend-Miru-Franco',
      endpoints: {
        health: '/salud',
        api: '/api',
        usuarios: '/api/usuarios',
        auth: {
          google: '/api/auth/google',
          verifyEmail: '/api/auth/verificar-correo',
          me: 'GET /api/auth/me',
          patchMe: 'PATCH /api/auth/me (perfil; foto: URL | null)',
        },
        seguridad: '/api/pregunta-seguridad',
        servicios: '/api/servicios',
        productos: '/api/productos',
        payments: {
          binLookup: 'GET /api/payments/bin-lookup?bin=',
          msiIndicio: 'GET /api/payments/msi-indicio?bancoEmisor=',
          metodosPago: 'GET|POST|PATCH|DELETE /api/payments/metodos-pago (JWT)',
        },
        db: {
          import: 'POST /api/db/import (multipart: tabla, archivo, formato?)',
          export: 'GET /api/db/export?tabla=&formato=csv|json',
          exportDirect: 'GET /api/db/export-direct (admin JWT; ver doc/API_PAYMENTS_AND_DB_EXPORT.md)',
          diagram: 'GET /api/db/diagram?formato=mermaid|svg|png',
        },
      },
    };
  }
}

