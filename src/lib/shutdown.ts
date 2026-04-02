import { db } from "@/lib/db";

let shuttingDown = false;

export function isShuttingDown() {
  return shuttingDown;
}

function handleShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[shutdown] Received ${signal}, shutting down gracefully...`);

  // Give in-flight requests time to finish, then force exit
  const forceTimeout = setTimeout(() => {
    console.error("[shutdown] Forced exit after timeout");
    process.exit(1);
  }, 15_000);
  forceTimeout.unref();

  db.$disconnect()
    .then(() => {
      console.log("[shutdown] Database disconnected");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[shutdown] Error disconnecting database:", err);
      process.exit(1);
    });
}

export function registerShutdownHandlers() {
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
}
