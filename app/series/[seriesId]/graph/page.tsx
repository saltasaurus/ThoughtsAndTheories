import { getRequestViewer } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/card";

/**
 * TODO (Phase 2): knowledge graph view — Cytoscape + fcose layout, weight →
 * edge thickness, card type → node color, degree-based sizing, type filter,
 * node cap with notice, click node → card detail panel.
 *
 * The gated data core already exists and is tested: lib/visibility.ts
 * graphData() omits gated cards entirely (no phantom nodes — position and
 * adjacency leak structure).
 */
export default async function GraphPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = await params;
  await getRequestViewer(seriesId); // membership check
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-3 text-2xl">Knowledge graph</h1>
      <Panel>
        <p className="text-sm text-soft">
          The interactive graph (Cytoscape, fcose layout) ships in Phase 2. Its server-side data
          endpoint is already built and spoiler-gated — gated cards are omitted entirely, never
          rendered as placeholder nodes.
        </p>
      </Panel>
    </div>
  );
}
