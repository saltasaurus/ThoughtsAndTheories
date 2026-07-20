"use client";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="mb-2 text-xl">Something went wrong</h1>
      <p className="mb-4 text-sm text-soft">{error.message || "Unexpected error"}</p>
      <button
        onClick={reset}
        className="rounded-md border border-line px-4 py-2 text-sm hover:bg-raised"
      >
        Try again
      </button>
    </main>
  );
}
