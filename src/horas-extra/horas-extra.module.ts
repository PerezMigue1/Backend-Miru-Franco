import { Module } from '@nestjs/common';
import { HorasExtraController } from './horas-extra.controller';
import { HorasExtraService } from './horas-extra.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HorasExtraController],
  providers: [HorasExtraService],
})
export class HorasExtraModule {}
