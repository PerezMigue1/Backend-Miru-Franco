import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityService } from './security.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}


