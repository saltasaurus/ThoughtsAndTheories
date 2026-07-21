import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/ui/card";
import { getRequestViewer } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { getCardDetail, listRevisions } from "@/lib/visibility";

type Row = {
  id: string;
  entity: "CARD" | "CARD_FIELD";
  /** field label for CARD_FIELD rows */
  label: string | null;
  userId: string;
  diff: unknown;
  createdAt: Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function display(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** before/after pairs for one diff, unioned over both sides' keys. */
function pairs(diff: unknown): Array<{ key: string; before: unknown; after: unknown }> {
  const d = asRecord(diff);
  if (!d) return [];
  const before = asRecord(d.before) ?? {};
  const after = asRecord(d.after) ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.map((key) => ({ key, before: before[key], after: after[key] }));
}

export default async function CardHistoryPage({
  params,
}: {
  params: Promise<{ seriesId: string; cardId: string }>;
}) {
  const { seriesId, cardId } = await params;
  const viewer = await getRequestViewer(seriesId);

  // Reuse the gated read: a card the viewer cannot see has no history page.
  const card = await getCardDetail(viewer, cardId);
  if (!card) notFound();

  // Card revisions plus those of every field the viewer can currently see.
  // Gated fields are absent from getCardDetail, so their revisions are never
  // even queried — the gate is enforced once, at the query layer.
  const [cardRevs, ...fieldRevs] = await Promise.all([
    listRevisions(viewer, "CARD", cardId),
    ...card.fields.map((f) => listRevisions(viewer, "CARD_FIELD", f.id)),
  ]);

  const rows: Row[] = [
    ...cardRevs.items.map((r) => ({
      id: r.id,
      entity: "CARD" as const,
      label: null,
      userId: r.userId,
      diff: r.diff,
      createdAt: r.createdAt,
    })),
    ...fieldRevs.flatMap((res, i) =>
      res.items.map((r) => ({
        id: r.id,
        entity: "CARD_FIELD" as const,
        label: card.fields[i]?.label ?? null,
        userId: r.userId,
        diff: r.diff,
        createdAt: r.createdAt,
      })),
    ),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const authors = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(authors.map((a) => [a.id, a.name]));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl">Revision history</h1>
      <p className="mb-3 text-sm text-soft">
        <Link href={`/series/${seriesId}/cards/${cardId}`} className="underline">
          {card.title}
        </Link>
      </p>

      {rows.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft">
            No revisions to show. Each revision records the reveal point it was written at, so an
            edit made while this card revealed later stays hidden until you reach that point — even
            if the card itself has since moved earlier.
          </p>
        </Panel>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Panel>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-soft">
                  <span className="rounded-full border border-line px-2 py-0.5 text-[11px] uppercase">
                    {r.entity === "CARD" ? "card" : "field"}
                  </span>
                  {r.label && <span className="text-sm text-fg">{r.label}</span>}
                  <span className="ml-auto tnum">{r.createdAt.toLocaleString()}</span>
                </div>
                <p className="mb-2 text-xs text-soft">{nameOf.get(r.userId) ?? "unknown"}</p>
                <ul className="space-y-1 text-sm">
                  {pairs(r.diff).map((p) => (
                    <li key={p.key} className="flex flex-wrap gap-2">
                      <span className="w-28 shrink-0 text-xs text-soft">{p.key}</span>
                      <span className="text-danger line-through">{display(p.before)}</span>
                      <span className="text-soft">→</span>
                      <span>{display(p.after)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
