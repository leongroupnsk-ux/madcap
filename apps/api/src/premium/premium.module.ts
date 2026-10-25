import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeModule } from '../me/me.module';
import { AdminPremiumController, PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';

@Module({ imports: [AuthModule, MeModule], controllers: [PremiumController, AdminPremiumController], providers: [PremiumService] })
export class PremiumModule {}
