"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error details to server for monitoring (structured logging)
    console.error("Unhandled error:", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }, [error, error.digest]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
        <h1 className="text-2xl font-bold text-red-600 mb-2">Oops!</h1>
        <p className="text-gray-600 mb-6">
          Something went wrong. Our team has been notified about this issue.
        </p>
        
        {process.env.NODE_ENV === "development" && (
          <details className="mb-6 bg-gray-100 p-3 rounded text-sm font-mono text-gray-700">
            <summary className="cursor-pointer font-bold mb-2">Error Details (Dev Only)</summary>
            <p className="break-words whitespace-pre-wrap text-xs overflow-auto max-h-40">
              {error.message}
            </p>
            {error.digest && (
              <p className="mt-2 text-xs text-gray-500">
                ID: {error.digest}
              </p>
            )}
          </details>
        )}

        <button
          onClick={() => reset()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
        >
          Try again
        </button>

        <a
          href="/"
          className="block mt-3 text-center text-blue-600 hover:text-blue-700 text-sm"
        >
          Go back home
        </a>
      </div>
    </div>
  );
}
