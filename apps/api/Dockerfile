# API: сборка из корня монорепозитория — docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @aesculap/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @aesculap/shared build \
 && pnpm --filter @aesculap/api exec prisma generate \
 && pnpm --filter @aesculap/api build \
 && pnpm --filter @aesculap/api deploy --prod --legacy /out \
 && cp -r apps/api/dist apps/api/prisma apps/api/scripts /out/ \
 && cd /out && npx prisma generate

FROM node:22-bookworm-slim
# ffmpeg — постеры видео; openssl — движок Prisma
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /app app && mkdir -p /data/storage && chown app /data/storage
WORKDIR /app
COPY --from=build --chown=app /out ./
USER app
ENV NODE_ENV=production API_PORT=4100 STORAGE_LOCAL_DIR=/data/storage
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4100/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Миграции применяются при старте; прежняя версия продолжает работать, пока новая не прошла healthcheck
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
