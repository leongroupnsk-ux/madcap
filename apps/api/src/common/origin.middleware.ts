import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF: изменяющие запросы принимаются только со своего origin (cookie SameSite=Lax + проверка Origin). */
@Injectable()
export class OriginMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (SAFE.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && origin !== config.webOrigin) throw new ForbiddenException({ message: 'Запрос с чужого сайта' });
    next();
  }
}
