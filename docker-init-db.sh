#!/bin/sh
set -eu

echo "Initializing database schema for load-test stack..."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required."
  exit 1
fi

if [ -z "${DIRECT_URL:-}" ]; then
  export DIRECT_URL="$DATABASE_URL"
fi

npx prisma db push --skip-generate --schema prisma/schema.prisma
node prisma/seed.cjs

echo "Database initialization completed."
