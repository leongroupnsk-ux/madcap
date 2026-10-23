import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminLegalController, LegalController } from './legal.controller';

@Module({ imports: [AuthModule], controllers: [LegalController, AdminLegalController] })
export class LegalModule {}
