import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(actorId: string | null, action: string, entity: string, entityId?: string, data?: Prisma.InputJsonValue) {
    await this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, data } });
  }
}
