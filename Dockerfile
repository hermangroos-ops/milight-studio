# syntax=docker/dockerfile:1.7

# --------------------------------------------------------------------------------------
# Build stage: install the whole workspace, typecheck, build the server and the web UI.
# --------------------------------------------------------------------------------------
FROM node:22-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo

# Copy only the manifests first so the dependency layer is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/milight-client/package.json packages/milight-client/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps

ARG APP_VERSION=0.0.0-dev
ENV APP_VERSION=$APP_VERSION

RUN pnpm run build

# Produce a self-contained, production-only tree for the server package.
RUN pnpm --filter @milight-studio/server deploy --legacy --prod /deploy

# --------------------------------------------------------------------------------------
# Runtime stage: no package manager, no build tools, no dev dependencies.
# --------------------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    WEB_ROOT=/app/web

LABEL org.opencontainers.image.title="Milight Studio" \
      org.opencontainers.image.description="Self-hosted controller for MiBoxer / Mi-Light lights with groups, scenes and Alexa support." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$APP_VERSION"

# The runtime never installs packages, and npm's own bundled dependencies are what
# the image scan keeps flagging - so the image ships without npm and corepack.
RUN apk add --no-cache tini && \
    rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack && \
    mkdir -p /data && chown -R node:node /data

WORKDIR /app

COPY --from=builder --chown=node:node /deploy/node_modules ./node_modules
COPY --from=builder --chown=node:node /deploy/dist ./dist
COPY --from=builder --chown=node:node /deploy/package.json ./package.json
COPY --from=builder --chown=node:node /repo/apps/web/dist ./web

USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards SIGTERM so the graceful shutdown path actually runs.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
