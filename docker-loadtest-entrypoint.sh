#!/bin/sh
set -eu

echo "Starting load-test app instance..."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required."
  exit 1
fi

if [ -z "${REDIS_URL:-}" ]; then
  echo "REDIS_URL is required for the load-test stack."
  exit 1
fi

exec node server.js
