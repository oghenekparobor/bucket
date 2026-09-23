# syntax=docker/dockerfile:1.7
#
# ONE image, four processes. The api, worker, keeper and web services all run this same image and
# differ only in the command they start:
#
#   api     node backend/dist/src/server.js     (or: pnpm --filter @bucket/backend start)
#   worker  node backend/dist/src/worker.js     (or: pnpm --filter @bucket/backend start:worker)
#   keeper  node backend/dist/src/keeper/main.js
#   web     node web/server.js                  (or: pnpm --filter @bucket/web start)
#
# It is deliberately not split per service. Platforms that build only the last stage of a Dockerfile
# (Railway) cannot choose a target, so a multi-target file silently ships the wrong image — the web
# service ran the backend image and failed with "next: not found" against a web/ that had a
# package.json but no node_modules. One image cannot be the wrong one.
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

# ── runtime ─────────────────────────────────────────────────────────────────────
# Production-only install of the backend and the SDK it links to.
FROM manifests AS backend-deps
RUN pnpm install --frozen-lockfile --prod --filter "@bucket/backend..."

FROM base AS runtime
ENV NODE_ENV=production
# Backend: node_modules/@bucket/sdk is a symlink to ../../vault/sdk, so vault/sdk must stay put.
# This also brings package.json and pnpm-workspace.yaml, which is what lets `pnpm --filter ... start`
# resolve inside the container.
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

# Web: Next's standalone bundle is self-contained — it carries its own node_modules, inlines the
# config into server.js and chdir's to its own directory — so it drops in over the manifest stub that
# the dependency stage left at web/. `docs/` sits beside it because the legal pages are read at runtime.
COPY --from=build --chown=node:node /app/web/.next/standalone/web ./web/
COPY --from=build --chown=node:node /app/web/.next/static ./web/.next/static
COPY --from=build --chown=node:node /app/web/.next/standalone/docs ./docs/

# Next copies the app's package.json into the bundle, scripts and all, but standalone ships no
# node_modules/.bin — so its `start` script (`next start`) would die with "next: not found". Point it
# at the bundled server, and bake in pnpm so starting with it costs no network round trip.
RUN node -e "const fs=require('fs'),p='web/package.json',j=JSON.parse(fs.readFileSync(p));j.scripts={start:'node server.js'};fs.writeFileSync(p,JSON.stringify(j,null,2))" \
  && chown node:node web/package.json \
  && (corepack prepare --activate || echo "corepack prepare skipped; pnpm will be fetched on first use")

USER node
# PORT is deliberately unset: the platform injects it, the backend defaults to 4000 and the Next
# server to 3000. HOSTNAME is what makes the Next server listen outside the container.
ENV HOSTNAME=0.0.0.0
EXPOSE 3000 4000
CMD ["node", "backend/dist/src/server.js"]
