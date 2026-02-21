FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production

FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
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
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create public directory if it doesn't exist
RUN mkdir -p /app/public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Render free tier workaround:
# Start app immediately (so port binds), then run DB setup in background with retries.
CMD ["sh", "-c", "set -e; echo 'Starting application...'; node server.js & APP_PID=$!; (echo 'Running database setup in background...'; i=1; while [ $i -le 5 ]; do echo \"DB setup attempt $i/5\"; if npm run db:setup; then echo 'Database setup completed.'; exit 0; fi; echo 'Database setup failed, retrying in 10s...'; i=$((i+1)); sleep 10; done; echo 'Database setup failed after retries.'; exit 1) & wait $APP_PID"]
