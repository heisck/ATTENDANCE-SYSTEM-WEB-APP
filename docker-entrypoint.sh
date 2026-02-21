#!/bin/sh
set -e

echo "Starting application..."
node server.js &
APP_PID=$!

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

echo "Running database setup in background..."
(
  i=1
  while [ $i -le 5 ]; do
    echo "DB setup attempt $i/5"
    if CI=1 npm run db:setup </dev/null; then
      echo "Database setup completed."
      exit 0
    fi

    echo "Database setup failed, retrying in 15s..."
    i=$((i+1))
    sleep 15
  done

  echo "Database setup failed after retries."
  exit 1
) &

wait $APP_PID
