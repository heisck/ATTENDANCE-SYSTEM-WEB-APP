FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --omit=dev --legacy-peer-deps

FROM base AS builder
WORKDIR /app
ARG AUTH_SECRET=build-only-auth-secret
ARG NEXTAUTH_SECRET=build-only-auth-secret
ARG AUTH_URL=http://localhost:3000
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG WEBAUTHN_RP_ID=localhost
ARG WEBAUTHN_ORIGIN=http://localhost:3000
ARG WEBAUTHN_RP_NAME=AttendanceIQ Build
ARG REMINDER_CRON_SECRET=build-only-reminder-secret
ARG NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY=build-only-public-key
ARG WEB_PUSH_PRIVATE_KEY=build-only-private-key
ENV AUTH_SECRET=$AUTH_SECRET
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV AUTH_URL=$AUTH_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV WEBAUTHN_RP_ID=$WEBAUTHN_RP_ID
ENV WEBAUTHN_ORIGIN=$WEBAUTHN_ORIGIN
ENV WEBAUTHN_RP_NAME=$WEBAUTHN_RP_NAME
ENV REMINDER_CRON_SECRET=$REMINDER_CRON_SECRET
ENV NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY=$NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY
ENV WEB_PUSH_PRIVATE_KEY=$WEB_PUSH_PRIVATE_KEY
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --legacy-peer-deps
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder /app/docker-init-db.sh ./docker-init-db.sh
COPY --from=builder /app/docker-loadtest-entrypoint.sh ./docker-loadtest-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh /app/docker-init-db.sh /app/docker-loadtest-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["/app/docker-entrypoint.sh"]
