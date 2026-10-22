import type { NextConfig } from 'next';

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

const config: NextConfig = {
  // Браузер ходит в API через тот же origin: cookie сессии first-party, CORS не нужен.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  poweredByHeader: false,
};

export default config;
