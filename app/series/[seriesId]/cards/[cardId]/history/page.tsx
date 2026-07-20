import { getRequestViewer } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/card";

/**
 * TODO (Phase 3): revision history browser. Revision WRITES and gated READS
 * are already real (Phase 1) — lib/visibility.ts listRevisions gates every
 * diff by its revealIndex snapshot; this page just doesn't render them yet.
 */
export default async function CardHistoryPage({
  params,
}: {
  params: Promise<{ seriesId: string; cardId: string }>;
}) {
  const { seriesId } = await params;
  await getRequestViewer(seriesId);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-3 text-2xl">Revision history</h1>
      <Panel>
        <p className="text-sm text-soft">
          The revision browser ships in Phase 3. Every edit is already recorded append-only, and
          revision reads are already spoiler-gated at the query layer.
        </p>
      </Panel>
    </div>
  );
}
