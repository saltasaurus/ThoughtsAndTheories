import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Fraunces: a warm, bookish display serif with real personality — right for a
// reading club without tipping into pastiche. Inter for body: highly readable,
// with proper tabular figures for indices.
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

/**
 * Nothing here is statically cacheable: every page is per-viewer, gated by the
 * reader's reveal position, and even /login queries the DB (isBootstrap). Next
 * infers dynamic rendering from cookies()/headers()/searchParams, so a page
 * that only calls a DB-backed helper looks static and gets prerendered at build
 * time — which fails in Docker, where no database is reachable. Applied at the
 * root so child segments inherit it rather than each remembering.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TheoryTracker",
  description: "A spoiler-safe worldbuilding wiki for book clubs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
