import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CapsuleService } from './capsule.service';
import { MeController } from './me.controller';
import { ProfileService } from './profile.service';

@Module({ imports: [AuthModule], controllers: [MeController], providers: [ProfileService, CapsuleService], exports: [CapsuleService] })
export class MeModule {}
