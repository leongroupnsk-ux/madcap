import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** В dev письма пишутся в лог (MAIL_DRIVER=console); SMTP-драйвер — этап E5-02. */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  readonly sent: Mail[] = [];

  async send(mail: Mail): Promise<void> {
    if (config.mailDriver === 'console') {
      this.sent.push(mail);
      this.logger.log(`→ ${mail.to} · ${mail.subject}\n${mail.text}`);
      return;
    }
    throw new Error(`Почтовый драйвер ${config.mailDriver} ещё не реализован`);
  }
}
