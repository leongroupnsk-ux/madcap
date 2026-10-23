import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Почта: в dev и тестах письма пишутся в лог (MAIL_DRIVER=console), в бою — SMTP транзакционного сервиса (SMTP_URL). */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  readonly sent: Mail[] = [];
  private transport?: Transporter;

  async send(mail: Mail): Promise<void> {
    if (config.mailDriver === 'console') {
      this.sent.push(mail);
      this.logger.log(`→ ${mail.to} · ${mail.subject}\n${mail.text}`);
      return;
    }
    if (config.mailDriver !== 'smtp' || !config.smtpUrl) throw new Error(`Почта не настроена: MAIL_DRIVER=${config.mailDriver}`);
    this.transport ??= createTransport(config.smtpUrl);
    await this.transport.sendMail({ from: config.mailFrom, to: mail.to, subject: mail.subject, text: mail.text });
  }
}
