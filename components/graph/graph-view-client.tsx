"use client";

import dynamic from "next/dynamic";

// The graph is a canvas-driven, browser-only visualization (color resolution,
// cytoscape itself) — SSR-ing it only produces a mismatched placeholder that
// triggers a hydration warning Next.js won't patch up, so skip SSR entirely.
export const GraphView = dynamic(() => import("./graph-view").then((m) => m.GraphView), {
  ssr: false,
});
