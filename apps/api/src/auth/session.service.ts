import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { newToken, sha256 } from '../common/crypto';
import { config } from '../config';

const DAY_MS = 86_400_000;

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, req: Request, res: Response): Promise<void> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + config.session.ttlDays * DAY_MS);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt,
        userAgent: req.headers['user-agent']?.slice(0, 300),
        ip: req.ip,
      },
    });
    res.cookie(config.session.cookieName, token, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  /** Пользователь по cookie; продлевает lastSeenAt не чаще раза в 10 минут. */
  async resolve(req: Request) {
    const token: string | undefined = req.cookies?.[config.session.cookieName];
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || session.user.deletedAt || session.user.blockedAt) return null;
    if (Date.now() - session.lastSeenAt.getTime() > 600_000) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }),
        this.prisma.user.update({ where: { id: session.userId }, data: { lastActiveAt: now } }),
      ]);
    }
    return { session, user: session.user };
  }

  async destroy(req: Request, res: Response): Promise<void> {
    const token: string | undefined = req.cookies?.[config.session.cookieName];
    if (token) await this.prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
    res.clearCookie(config.session.cookieName, { path: '/' });
  }

  async destroyAllForUser(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }
}
