import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCapsuleController } from './admin-capsule.controller';
import { CapsuleService } from './capsule.service';
import { AdminUsersController, MeController } from './me.controller';
import { PrivacyService } from './privacy.service';
import { ProfileService } from './profile.service';

@Module({ imports: [AuthModule], controllers: [MeController, AdminUsersController, AdminCapsuleController], providers: [ProfileService, CapsuleService, PrivacyService], exports: [CapsuleService] })
export class MeModule {}
