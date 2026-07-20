import { GraphView } from "@/components/graph/graph-view";
import { Panel } from "@/components/ui/card";
import { getRequestViewer } from "@/lib/auth-helpers";
import { graphData } from "@/lib/visibility";

export default async function GraphPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = await params;
  const viewer = await getRequestViewer(seriesId);
  const { nodes, edges, truncated } = await graphData(viewer);

  return (
    <div>
      <h1 className="mb-1 text-2xl">Knowledge graph</h1>
      <p className="mb-3 text-xs text-soft">
        Cards you&apos;ve reached and their relations. Click a node for its connections; toggle
        types to filter. Everything here is already server-side gated.
      </p>
      {nodes.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft">
            No cards are visible at your current reading position yet — advance your progress or add
            cards to populate the graph.
          </p>
        </Panel>
      ) : (
        <GraphView nodes={nodes} edges={edges} truncated={truncated} seriesId={seriesId} />
      )}
    </div>
  );
}
