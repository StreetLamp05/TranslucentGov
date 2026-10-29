# syntax=docker/dockerfile:1
# Images for docker-compose.yml (§1.1.1). Two targets:
#   app     the Next.js standalone server
#   worker  the pg-boss worker (worker/index.ts), also used to run migrations

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS source
COPY . .

FROM source AS build
# NEXT_PUBLIC_* values are baked into the browser bundle at build time.
ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY
ARG NEXT_PUBLIC_GOOGLE_MAP_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM source AS worker
ENV NODE_ENV=production
USER node
# tsx directly, not `npm run worker`: npm doesn't pass SIGTERM on, so `docker stop` would kill
# a running job instead of letting worker/index.ts stop gracefully.
CMD ["node_modules/.bin/tsx", "worker/index.ts"]
