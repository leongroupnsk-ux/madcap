import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../config';

type Handler = (data: any) => Promise<void>;

/**
 * Фоновые задачи на BullMQ (импорт, медиа, синк YML).
 * JOBS_INLINE=1 — выполнять сразу в процессе (тесты), без очереди.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, Handler>();
  private readonly failureHooks: ((name: string, err: Error) => void)[] = [];
  private queue?: Queue;
  private worker?: Worker;
  readonly inline = process.env.JOBS_INLINE === '1';

  register(name: string, handler: Handler) {
    this.handlers.set(name, handler);
  }

  private readonly connection = { url: config.redisUrl, maxRetriesPerRequest: null };

  /** Очередь — сразу: модули в своих onModuleInit ставят повторяющиеся задачи (repeat) */
  async onModuleInit() {
    if (this.inline) return;
    this.queue = new Queue('aesculap', { connection: this.connection });
  }

  /**
   * Обработчик очереди — только когда все модули зарегистрировали свои задачи. Раньше он запускался в onModuleInit,
   * и задача, подошедшая к сроку во время перезапуска, падала с «Нет обработчика задачи» (так при каждой выкладке).
   */
  onApplicationBootstrap() {
    if (this.inline) return;
    const connection = this.connection;
    this.worker = new Worker(
      'aesculap',
      async (job: Job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`Нет обработчика задачи ${job.name}`);
        await handler(job.data);
      },
      { connection, concurrency: 4 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`${job?.name} #${job?.id}: ${err.message}`);
      // Сообщение об ошибке — только когда попытки кончились: промежуточные сбои задача переживает сама
      if (!job || job.attemptsMade >= (job.opts.attempts ?? 1)) for (const hook of this.failureHooks) hook(job?.name ?? 'неизвестная задача', err);
    });
  }

  /** Задача упала окончательно, все попытки исчерпаны (monitoring/error-alerts.service.ts) */
  onFinalFailure(hook: (name: string, err: Error) => void) {
    this.failureHooks.push(hook);
  }

  async enqueue(name: string, data: unknown, opts: { attempts?: number; jobId?: string } = {}) {
    if (this.inline) {
      const handler = this.handlers.get(name);
      if (!handler) throw new Error(`Нет обработчика задачи ${name}`);
      await handler(data);
      return;
    }
    await this.queue!.add(name, data, {
      attempts: opts.attempts ?? 3,
      backoff: { type: 'exponential', delay: 5000 },
      jobId: opts.jobId,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /** Повторяющаяся задача (cron). В inline-режиме не планируется. */
  async repeat(name: string, everyMs: number) {
    if (this.inline) return;
    await this.queue!.upsertJobScheduler(name, { every: everyMs }, { name, data: {} });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
