# syntax=docker/dockerfile:1.7
#
# Two images from one file:
#   docker build --target backend -t bucket-backend .
#   docker build --target web     -t bucket-web .
#
# Railway and other platforms that always build the *last* stage cannot pass --target, so the last
# stage is selected by a build variable instead: set TARGET=backend or TARGET=web on the service.
# Declared here, before the first FROM, because only a global ARG can be used in a FROM line.
ARG TARGET=backend
#
# The backend image runs all three backend processes — API, worker (indexer + jobs) and keeper —
# by overriding the command; they are the same build with different entry points. See docs/ops/deploy.md.
#
# `@bucket/sdk` is a workspace package whose types live in its own dist/, so the backend cannot be
# built on its own: `--filter "@bucket/backend..."` (trailing dots = "and its dependencies") builds
# the SDK first. Building only the backend fails with "Cannot find module '@bucket/sdk'".

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ── dependencies ────────────────────────────────────────────────────────────────
# Manifests only, so this layer survives every source edit. pnpm needs the manifest of each project
# in pnpm-workspace.yaml to satisfy the lockfile, including the ones no image ships.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY web/package.json web/
COPY vault/sdk/package.json vault/sdk/
COPY vault/tests/package.json vault/tests/
COPY vault/scripts/package.json vault/scripts/

FROM manifests AS deps
# No --mount=type=cache here: Railway requires cache mount ids to be `s/<service id>-<path>` and
# forbids variables in them, so no single id can be valid for the four services sharing this file.
# Layer caching still does the real work — this step only re-runs when a manifest or the lockfile changes.
RUN pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# Next inlines NEXT_PUBLIC_* at build time, so a web image is tied to the environment it was built
# for. Pass these with --build-arg; the backend reads its own configuration at runtime instead.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_API_MODE=auto
ARG NEXT_PUBLIC_PRIVY_APP_ID=
ARG NEXT_PUBLIC_PRIVY_CLIENT_ID=
ARG NEXT_PUBLIC_SOLANA_CLUSTER=devnet
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_ENABLE_CARD_FUNDING=false
ARG NEXT_PUBLIC_USDC_MINT=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_API_MODE=$NEXT_PUBLIC_API_MODE \
    NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_PRIVY_CLIENT_ID=$NEXT_PUBLIC_PRIVY_CLIENT_ID \
    NEXT_PUBLIC_SOLANA_CLUSTER=$NEXT_PUBLIC_SOLANA_CLUSTER \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ENABLE_CARD_FUNDING=$NEXT_PUBLIC_ENABLE_CARD_FUNDING \
    NEXT_PUBLIC_USDC_MINT=$NEXT_PUBLIC_USDC_MINT
RUN pnpm --filter "@bucket/backend..." build
RUN pnpm --filter "@bucket/web" build

# ── backend runtime ─────────────────────────────────────────────────────────────
# A production-only install of just the backend and the SDK it links to.
FROM manifests AS backend-deps
RUN pnpm install --frozen-lockfile --prod --filter "@bucket/backend..."

FROM base AS backend
ENV NODE_ENV=production PORT=4000
# node_modules/@bucket/sdk is a symlink to ../../vault/sdk, so vault/sdk must stay where it is.
COPY --from=backend-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/vault/sdk/dist vault/sdk/dist
COPY --from=build --chown=node:node /app/backend/dist backend/dist
# Read at runtime, all resolved from the package root by paths.ts, so they must sit beside dist/:
#   migrations/       db/migrate.ts, on every start
#   assets/fonts/     the PnL card renderer
#   config/           geo-restrictions.json (api/geo.ts, read while the app is built) and
#                     issuer-events.json (catalog/issuerEvents.ts)
# and one level up, the deployment file config.ts reads at vault/deployments/<cluster>.json.
COPY --chown=node:node backend/migrations backend/migrations
COPY --chown=node:node backend/assets backend/assets
COPY --chown=node:node backend/config backend/config
COPY --chown=node:node vault/deployments vault/deployments
USER node
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Override for the other two processes:
#   worker: node dist/src/worker.js      (indexer + scheduled jobs — without it the app never sees new buckets)
#   keeper: node dist/src/keeper/main.js (fills mint and redeem orders)
CMD ["node", "dist/src/server.js"]

# ── web runtime ─────────────────────────────────────────────────────────────────
# Next's standalone output carries only the traced dependencies, so no node_modules install here.
# outputFileTracingRoot is the workspace root, so the bundle mirrors the repo: web/server.js.
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/web/.next/standalone ./
COPY --from=build --chown=node:node /app/web/.next/static ./web/.next/static
# Next copies the app's package.json into the bundle, scripts and all, but standalone ships no
# node_modules/.bin — so its `start` script (`next start`) dies with "next: not found". Point it at
# the bundled server, so running the script and running the image's CMD do the same thing.
RUN node -e "const fs=require('fs'),p='web/package.json',j=JSON.parse(fs.readFileSync(p));j.scripts={start:'node server.js'};fs.writeFileSync(p,JSON.stringify(j,null,2))" \
  && chown node:node web/package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web/server.js"]

# ── final stage selector ────────────────────────────────────────────────────────
# Building with no --target lands here and resolves to the stage named by TARGET, so one Dockerfile
# serves both services on a platform that cannot choose a stage. FROM carries the selected stage's
# CMD, ENV, USER, EXPOSE and HEALTHCHECK over unchanged. `docker build --target backend|web` still
# works and bypasses this entirely.
FROM ${TARGET} AS final
