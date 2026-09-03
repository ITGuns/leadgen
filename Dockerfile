# LeadForge — multi-stage build (ARCH A1). Native modules (better-sqlite3, DuckDB)
# ship linux prebuilds; the toolchain layer exists only as a fallback for platforms
# without them. Runtime is the Next standalone output + traced node_modules.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 1001 leadforge && useradd -u 1001 -g leadforge -m leadforge \
  && mkdir -p /data && chown leadforge:leadforge /data

# standalone server + static assets
COPY --from=build --chown=leadforge:leadforge /app/.next/standalone ./
COPY --from=build --chown=leadforge:leadforge /app/.next/static ./.next/static
COPY --from=build --chown=leadforge:leadforge /app/public ./public
# runtime-read assets that live outside the JS graph
COPY --from=build --chown=leadforge:leadforge /app/drizzle ./drizzle
COPY --from=build --chown=leadforge:leadforge /app/data ./data
COPY --from=build --chown=leadforge:leadforge /app/config ./config
COPY --from=build --chown=leadforge:leadforge /app/fixtures/mock ./fixtures/mock

USER leadforge
# /data survives redeploys — DATABASE_PATH, EXPORTS_DIR, BACKUPS_DIR, CONFIG_DIR point here
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
