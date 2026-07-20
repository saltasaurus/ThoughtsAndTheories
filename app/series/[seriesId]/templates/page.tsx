import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/card";
import { getRequestViewer } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";

/**
 * TODO (Phase 3): visual template editor. The data model and per-series
 * seeding are real (Phase 1); this page is a read-only view until then.
 */
export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = await params;
  const viewer = await getRequestViewer(seriesId);
  if (viewer.role !== "OWNER") redirect(`/series/${seriesId}/cards`);

  const templates = await prisma.template.findMany({
    where: { seriesId },
    include: { fields: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
    orderBy: { cardType: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl">Templates</h1>
      <p className="mb-3 text-xs text-soft">
        Read-only for now — the visual template editor ships in Phase 3.
      </p>
      <div className="space-y-3">
        {templates.map((t) => (
          <Panel key={t.id}>
            <h2 className="mb-2 text-lg capitalize">{t.cardType.toLowerCase()}</h2>
            <ul className="space-y-1 text-sm">
              {t.fields.map((f) => (
                <li key={f.id} className="flex gap-3">
                  <span className="w-40 font-medium">{f.label}</span>
                  <span className="text-soft">{f.fieldType.toLowerCase()}</span>
                  {f.required && <span className="text-danger">required</span>}
                  <span className="text-[11px] text-soft">
                    default reveal: {f.defaultRevealBehavior === "CARD" ? "same as card" : "series start"}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
