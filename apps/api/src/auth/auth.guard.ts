import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { SessionService } from './session.service';

type AuthedRequest = Request & { user?: User };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const resolved = await this.sessions.resolve(req);
    if (!resolved) throw new UnauthorizedException({ message: 'Нужно войти' });
    req.user = resolved.user;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user as User,
);
