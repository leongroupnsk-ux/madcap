import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthGuard, RolesGuard],
  exports: [AuthService, SessionService, AuthGuard, RolesGuard],
})
export class AuthModule {}
