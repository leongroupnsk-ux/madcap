import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// swc нужен, чтобы сохранялись метаданные декораторов для DI Nest.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    env: {
      DATABASE_URL: 'postgresql://aesculap:aesculap@localhost:5432/aesculap_test',
      REDIS_URL: 'redis://localhost:6379/6',
      WEB_ORIGIN: 'http://localhost:4000',
      MAIL_DRIVER: 'console',
      JOBS_INLINE: '1',
      STOREFRONT_REQUIRE_PAYOUTS: 'true',
      REMOTE_FETCH_ALLOW_PRIVATE: '1',
      STORAGE_LOCAL_DIR: './.storage-test',
    },
    include: ['test/**/*.test.ts'], fileParallelism: false, testTimeout: 20000 },
});
