import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, merge, interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificacionesService } from './notificaciones.service';
import { NotificacionesSseService } from '../../notificaciones/sse/notificaciones-sse.service';
import { CreateNotificacionDto } from './dto/create-notificacion.dto';
import { UpdateNotificacionDto } from './dto/update-notificacion.dto';

const KEEP_ALIVE_MS = 28_000;

@Controller('notificaciones')
@UseGuards(JwtAuthGuard)
export class NotificacionesController {
  constructor(
    private readonly service: NotificacionesService,
    private readonly sse: NotificacionesSseService,
  ) {}

  // Declarado ANTES de `@Get(':id')` a propósito: Nest/Express resolvería
  // '/notificaciones/stream' contra la ruta ':id' (ParseUUIDPipe rechazándola
  // con 400) si esta se registrara después, porque ambas rutas conviven en el
  // mismo controller/prefijo y el match es por orden de declaración.
  @Sse('stream')
  stream(@CurrentUser() user: { id: string }): Observable<MessageEvent> {
    const keepAlive$: Observable<MessageEvent> = interval(KEEP_ALIVE_MS).pipe(
      map(() => ({ type: 'keep-alive', data: '' }) as MessageEvent),
    );
    // No es un comentario SSE crudo (`: keep-alive\n\n`): el serializador de
    // @Sse() de Nest (SseStream) solo sabe emitir líneas `event:`/`data:` a
    // partir de un MessageEvent, no expone forma de escribir una línea `:`
    // literal. Este evento 'keep-alive' cumple el mismo propósito (mantiene
    // bytes fluyendo para que el proxy de Render no corte la conexión
    // ociosa), pero es un evento nombrado, no un comentario invisible para el
    // cliente — si el frontend usa `EventSource.onmessage` a secas lo verá
    // como cualquier otro evento con ese `type`.
    return merge(this.sse.stream(user.id), keepAlive$);
  }

  @Get()
  listar(
    @CurrentUser() user: { id: string },
    @Query('usuarioId') usuarioId?: string,
    @Query('leida') leida?: string,
  ) {
    const leidaBool =
      leida === 'true' ? true : leida === 'false' ? false : undefined;
    return this.service.listar(user.id, {
      usuarioId,
      leida: leidaBool,
    });
  }

  @Get(':id')
  obtener(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.obtenerPorId(id, user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles('admin')
  crearAdmin(@Body() dto: CreateNotificacionDto) {
    return this.service.crearAdmin(dto);
  }

  @Put(':id')
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateNotificacionDto,
  ) {
    return this.service.actualizar(id, user.id, dto);
  }

  @Delete(':id')
  eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.eliminar(id, user.id);
  }
}
