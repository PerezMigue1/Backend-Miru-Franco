import { PartialType } from '@nestjs/mapped-types';
import { CreatePaqueteDto } from './create-paquete.dto';

export class UpdatePaqueteDto extends PartialType(CreatePaqueteDto) {}