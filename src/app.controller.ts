import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  @Version(VERSION_NEUTRAL)
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
          me: '/api/auth/me',
        },
        seguridad: '/api/pregunta-seguridad',
      },
    };
  }
}

