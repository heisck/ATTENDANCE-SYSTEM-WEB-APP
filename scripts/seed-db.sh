#!/bin/bash

# Seed the database
echo "Seeding database..."
cd "$(dirname "$0")/.."

# Ensure .env.local has DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

# Run Prisma push to ensure schema is up to date
echo "Pushing schema to database..."
npx prisma db push --skip-generate

# Run seed script
echo "Running seed script..."
npx ts-node prisma/seed.ts

echo "Done!"
