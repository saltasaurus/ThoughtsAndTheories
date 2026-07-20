/** Renders the ?error= query set by runAndRedirect. */
export function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );
}
