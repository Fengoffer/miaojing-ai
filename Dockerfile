# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS build

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV="production"
ENV COZE_PROJECT_ENV="PROD"
ENV APP_RUNTIME_ROLE="full"
ENV APP_BIND_HOST="0.0.0.0"
ENV DEPLOY_RUN_PORT="5000"
ENV COZE_WORKSPACE_PATH="/app"
ENV LOCAL_STORAGE_DIR="/data/storage"
ENV BACKUP_DIR="/data/backups"
ENV UPGRADE_STATE_DIR="/data/upgrade"
ENV MIAOJING_LOAD_ENV_FILE="0"
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl postgresql-client tini \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.0.0 --activate \
  && mkdir -p /app /data/storage /data/backups /data/upgrade

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -fsS http://127.0.0.1:5000/api/health >/dev/null || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["bash", "scripts/start.sh", "5000"]
