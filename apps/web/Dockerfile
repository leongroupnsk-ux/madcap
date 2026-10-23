# Сайт: сборка из корня монорепозитория — docker build -f apps/web/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @aesculap/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# Адрес API для /api/* фиксируется при сборке (rewrites Next.js)
ARG API_INTERNAL_URL=http://api:4100
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone API_INTERNAL_URL=$API_INTERNAL_URL
RUN pnpm --filter @aesculap/shared build && pnpm --filter @aesculap/web build

FROM node:22-bookworm-slim
RUN useradd --system --uid 10001 --home /app app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4000 HOSTNAME=0.0.0.0
COPY --from=build --chown=app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
