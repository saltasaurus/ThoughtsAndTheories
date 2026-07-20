import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="mb-2 text-2xl">Not found</h1>
      <p className="mb-4 text-sm text-soft">
        This page doesn&apos;t exist — or it&apos;s beyond your reading position.
      </p>
      <Link href="/" className="text-accent underline">
        Back to your series
      </Link>
    </main>
  );
}
