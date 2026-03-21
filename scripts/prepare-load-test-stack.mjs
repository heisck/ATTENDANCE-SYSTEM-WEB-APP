import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const targetScript = path.join(currentDir, "prepare-load-test.mjs");

const STACK_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:55432/attendance_db?schema=public";
const STACK_REDIS_URL = "redis://localhost:56379";
const STACK_BASE_URL = "http://localhost:8080";
const STACK_PREWARM_TARGETS = [
  "http://app-1:3000",
  "http://app-2:3000",
  "http://app-3:3000",
];
const FIXTURE_META_FILE = path.join(
  process.cwd(),
  "load-tests",
  "fixtures",
  "attendance-meta.json"
);

// Force the prep script to use the Docker load-test stack even when local
// development values are present in .env.
process.env.DATABASE_URL = STACK_DATABASE_URL;
process.env.DIRECT_URL = STACK_DATABASE_URL;
process.env.REDIS_URL = STACK_REDIS_URL;
process.env.LOAD_TEST_BASE_URL = STACK_BASE_URL;
process.env.AUTH_SECRET ||= "dev-secret-change-in-production-abc123xyz";
process.env.NEXTAUTH_SECRET ||= process.env.AUTH_SECRET;

const result = spawnSync(process.execPath, [targetScript, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.status === 0) {
  const meta = JSON.parse(readFileSync(FIXTURE_META_FILE, "utf8"));
  const prewarmScript = [
    'const targets = (process.env.TARGETS || "").split(",").map((value) => value.trim()).filter(Boolean);',
    'const sessionId = (process.env.SESSION_ID || "").trim();',
    'const secret = process.env.SECRET || "";',
    "",
    'if (!targets.length || !sessionId || !secret) {',
    "  process.exit(1);",
    "}",
    "",
    "const run = async () => {",
    "  for (const target of targets) {",
    '    const response = await fetch(target + "/api/internal/attendance/prewarm", {',
    '      method: "POST",',
    "      headers: {",
    '        "Content-Type": "application/json",',
    '        "x-attendance-prewarm-token": secret,',
    "      },",
    "      body: JSON.stringify({ sessionId }),",
    '      cache: "no-store",',
    "    });",
    "",
    "    if (!response.ok) {",
    '      const details = await response.text().catch(() => "");',
    '      const suffix = details ? ": " + details.slice(0, 200) : "";',
    '      throw new Error("Prewarm request to " + target + " failed with " + response.status + suffix);',
    "    }",
    "  }",
    "};",
    "",
    "run().catch((error) => {",
    "  console.error(error instanceof Error ? error.message : String(error));",
    "  process.exit(1);",
    "});",
  ].join("\n");

  const prewarmResult = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "attendance-loadtest_default",
      "-e",
      `TARGETS=${STACK_PREWARM_TARGETS.join(",")}`,
      "-e",
      `SESSION_ID=${meta.sessionId}`,
      "-e",
      `SECRET=${process.env.AUTH_SECRET}`,
      "node:24-alpine",
      "node",
      "-e",
      prewarmScript,
    ],
    {
      stdio: "inherit",
    }
  );

  if (prewarmResult.status !== 0) {
    process.exit(typeof prewarmResult.status === "number" ? prewarmResult.status : 1);
  }
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
