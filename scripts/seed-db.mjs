#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
      } else {
        resolve();
      }
    });

    proc.on('error', reject);
  });
}

async function main() {
  try {
    console.log('🌱 Starting database setup...\n');

    // Check DATABASE_URL
    if (!process.env.DATABASE_URL) {
      console.error('❌ ERROR: DATABASE_URL environment variable is not set');
      process.exit(1);
    }

    // Push schema to database
    console.log('📋 Pushing schema to database...');
    await runCommand('npx', ['prisma', 'db', 'push', '--skip-generate']);

    // Run seed script
    console.log('\n🌱 Running seed script...');
    await runCommand('npx', ['ts-node', 'prisma/seed.ts']);

    console.log('\n✅ Database setup complete!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
