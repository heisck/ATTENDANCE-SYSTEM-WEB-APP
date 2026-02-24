# Vercel + Neon Deployment Guide

This project is ready for Vercel hosting with a Neon Postgres database.

## 1. Prerequisites

- Vercel account
- Neon account
- GitHub/GitLab/Bitbucket repo connected to Vercel
- Node.js 20+

## 2. Create Neon Database

1. Create a Neon project and database.
2. Copy two connection strings from Neon:
   - Pooled connection string (for app runtime) -> `DATABASE_URL`
   - Direct connection string (for Prisma direct operations) -> `DIRECT_URL`

Use Neon-provided URLs directly. Do not remove SSL parameters.

## 3. Required Vercel Environment Variables

Set these in Vercel Project -> Settings -> Environment Variables:

- `DATABASE_URL` (Neon pooled URL)
- `DIRECT_URL` (Neon direct URL)
- `AUTH_SECRET` (random 32+ byte secret)
- `AUTH_URL` (your production URL, for example `https://your-app.vercel.app`)
- `NEXT_PUBLIC_APP_URL` (same value as `AUTH_URL`)
- `WEBAUTHN_RP_ID` (domain only, for example `your-app.vercel.app`)
- `WEBAUTHN_ORIGIN` (full origin, for example `https://your-app.vercel.app`)
- `REMINDER_CRON_SECRET` (long random secret)

Optional but recommended if used:

- `REDIS_URL` or `UPSTASH_REDIS_URL`
- `GMAIL_SMTP_USER`
- `GMAIL_SMTP_APP_PASSWORD`
- `GMAIL_FROM_EMAIL`
- `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`

Generate secure secrets with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Optional CLI way to add vars:

```powershell
npx vercel env add DATABASE_URL production
npx vercel env add DIRECT_URL production
npx vercel env add AUTH_SECRET production
npx vercel env add AUTH_URL production
npx vercel env add NEXT_PUBLIC_APP_URL production
npx vercel env add WEBAUTHN_RP_ID production
npx vercel env add WEBAUTHN_ORIGIN production
npx vercel env add REMINDER_CRON_SECRET production
```

## 4. One-Time Database Sync to Neon

Run once from your machine after setting `DATABASE_URL` and `DIRECT_URL` in local `.env`:

```powershell
npm ci
npx prisma generate
npx prisma db push
npm run db:seed
```

If you do not want seed data in production, skip `npm run db:seed`.

## 5. Deploy to Vercel

This repo includes:

- `vercel.json`
- `installCommand: npm ci`
- `buildCommand: npm run build`

Build command already runs Prisma client generation:

```bash
npm run build
```

Deploy options:

```powershell
# First-time link (optional if using Vercel Git integration)
npm run vercel:link

# Preview deploy
npm run deploy:preview

# Production deploy
npm run deploy:prod
```

If you use Git integration, pushing to your production branch is enough for deployment.

## 6. Post-Deploy Checks

```powershell
# Replace with your deployed URL
$APP_URL="https://your-app.vercel.app"

# Basic app reachability
curl -I "$APP_URL/login"

# Optional reminder engine trigger (requires REMINDER_CRON_SECRET)
curl -X POST "$APP_URL/api/notifications/run-reminders" `
  -H "x-cron-secret: YOUR_REMINDER_CRON_SECRET"
```

## 7. WebAuthn Domain Notes

- `WEBAUTHN_RP_ID` must match your real domain.
- `WEBAUTHN_ORIGIN` must be exact protocol + domain.
- If you change from `*.vercel.app` to a custom domain later, update both values.

## 8. Useful Commands Summary

```powershell
npm ci
npm run build
npm run db:deploy
npm run deploy:preview
npm run deploy:prod
```
