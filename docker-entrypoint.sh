#!/bin/sh
set -e

echo "Starting application..."

if [ -n "$DATABASE_URL" ]; then
  echo "DATABASE_URL is set."
else
  echo "DATABASE_URL is NOT set."
fi

if [ -n "$DIRECT_URL" ]; then
  echo "DIRECT_URL is set."
else
  echo "DIRECT_URL is NOT set. Prisma will use DATABASE_URL for direct operations."
fi

echo "Running database setup..."
i=1
while [ $i -le 5 ]; do
  echo "DB setup attempt $i/5"
  if CI=1 npm run db:setup </dev/null; then
    echo "Database setup completed."
    break
  fi

  if [ $i -eq 5 ]; then
    echo "Database setup failed after retries."
    exit 1
  fi

  echo "Database setup failed, retrying in 15s..."
  i=$((i+1))
  sleep 15
done

echo "Launching Next.js server..."
exec node server.js
