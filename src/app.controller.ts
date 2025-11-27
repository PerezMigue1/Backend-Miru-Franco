import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return {
      message: 'Miru Franco Backend API',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        health: '/salud',
        api: '/api',
        googleAuth: '/api/auth/google',
      },
    };
  }
}

