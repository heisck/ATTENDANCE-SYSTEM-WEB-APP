import { NextResponse } from "next/server";

/**
 * User-friendly error message for API responses.
 * These are safe to return to clients.
 */
export const ApiErrorMessages = {
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Access denied",
  NOT_FOUND: "Resource not found",
  CONFLICT: "Resource already exists",
  INVALID_INPUT: "Invalid input provided",
  SERVER_ERROR: "An error occurred while processing your request",
  WEBAUTHN_ERROR: "Authentication failed. Please try again.",
  WEBAUTHN_CHALLENGE_FAILED: "Challenge validation failed. Please start over.",
  SESSION_NOT_FOUND: "Session not found or no longer active",
  INSUFFICIENT_PERMISSIONS: "You don't have permission to perform this action",
} as const;

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured logging utility for consistent, machine-readable logs.
 * Always use this instead of console.log/warn/error for proper monitoring.
 */
export function log(
  level: LogLevel,
  context: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    context,
    message,
    ...(metadata && Object.keys(metadata).length > 0 && { metadata }),
  };

  // Use appropriate console method based on level
  switch (level) {
    case "debug":
      if (process.env.NODE_ENV === "development") {
        console.debug(JSON.stringify(logEntry));
      }
      break;
    case "info":
      console.log(JSON.stringify(logEntry));
      break;
    case "warn":
      console.warn(JSON.stringify(logEntry));
      break;
    case "error":
      console.error(JSON.stringify(logEntry));
      break;
  }
}

/**
 * Log detailed error information server-side (for debugging).
 * Only detailed error messages and stack traces go to server logs,
 * never to the client.
 */
export function logError(
  context: string,
  error: unknown,
  metadata?: Record<string, unknown>
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  log("error", context, errorMessage, {
    ...metadata,
    ...(stack && { stack }),
  });
}

/**
 * Handle API errors safely by returning sanitized messages to clients
 * while logging detailed errors server-side.
 */
export function handleApiError(
  error: unknown,
  context: string,
  metadata?: Record<string, unknown>,
  userMessage?: string
) {
  logError(context, error, metadata);

  const message = userMessage || ApiErrorMessages.SERVER_ERROR;
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Create a validated error response with proper status codes.
 */
export function apiErrorResponse(
  message: string,
  status: number = 400,
  metadata?: Record<string, unknown>
) {
  log("warn", "api_error_response", message, { status, ...metadata });
  return NextResponse.json({ error: message }, { status });
}
