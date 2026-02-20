#!/bin/sh
set -e

echo "Starting application server..."

# Run Prisma migrations in background to avoid blocking startup
echo "Setting up database..."
npx prisma migrate deploy 2>/dev/null || npx prisma db push 2>/dev/null || true

# Seed database if needed
echo "Seeding initial data..."
npx tsx prisma/seed.ts 2>/dev/null || true

# Start the application
echo "Starting Next.js server..."
exec node server.js
