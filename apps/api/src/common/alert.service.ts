import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { MailService } from './mail.service';

/**
 * Алерты дежурному (ТЗ §11): падение вебхуков оплаты и другие сбои, требующие человека.
 * Адрес — ALERT_EMAIL; не чаще раза в 10 минут на одинаковую тему, чтобы не завалить почту.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger('Alert');
  private readonly last = new Map<string, number>();

  constructor(private readonly mail: MailService) {}

  async send(subject: string, text: string) {
    this.logger.error(`${subject}\n${text}`);
    if (!config.alertEmail) return;
    const now = Date.now();
    if ((this.last.get(subject) ?? 0) > now - 600_000) return;
    this.last.set(subject, now);
    await this.mail.send({ to: config.alertEmail, subject: `[${config.brandName}] ${subject}`, text }).catch((e) => this.logger.error(`alert mail: ${e.message}`));
  }
}
