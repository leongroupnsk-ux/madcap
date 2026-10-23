import { Global, Module } from '@nestjs/common';
import { AlertService } from './alert.service';
import { SettingsService } from './settings.service';
import { AuditService } from './audit.service';
import { FilesController } from './files.controller';
import { JobsService } from './jobs.service';
import { MailService } from './mail.service';
import { PrismaService } from './prisma.service';
import { RateLimitService } from './rate-limit.service';
import { RedisService } from './redis.service';
import { StorageService } from './storage.service';

const services = [SettingsService, AlertService, PrismaService, RedisService, RateLimitService, MailService, StorageService, AuditService, JobsService];

@Global()
@Module({ controllers: [FilesController], providers: services, exports: services })
export class CommonModule {}
