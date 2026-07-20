import { Trash2 } from "lucide-react";
import { redirect } from "next/navigation";
import {
  createBookAction,
  createPartAction,
  deleteBookAction,
  deletePartAction,
  deleteSectionAction,
  insertSectionAction,
  updateSectionAction,
} from "@/app/actions/structure";
import { ErrorNote } from "@/components/error-note";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getRequestViewer } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { sectionTypeLabel } from "@/lib/section-label";
import { listSectionOptions } from "@/lib/visibility";

const SECTION_TYPES = [
  "PROLOGUE",
  "PRELUDE",
  "CHAPTER",
  "INTERLUDE",
  "EPILOGUE",
  "END_NOTES",
  "APPENDIX",
  "OTHER",
] as const;

export default async function StructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { seriesId } = await params;
  const { error } = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  if (viewer.role !== "OWNER") redirect(`/series/${seriesId}/cards`);

  const [books, options] = await Promise.all([
    prisma.book.findMany({
      where: { seriesId, deletedAt: null },
      orderBy: { order: "asc" },
      include: {
        parts: { where: { deletedAt: null }, orderBy: { order: "asc" } },
        sections: { where: { deletedAt: null }, orderBy: { position: "asc" } },
      },
    }),
    listSectionOptions(viewer), // gated titles for display
  ]);
  const gatedTitle = new Map(options.map((o) => [o.id, o.title]));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl">Structure</h1>
      <p className="mb-3 text-xs text-soft">
        Position is a dense, series-global sequence; every structural edit recomputes it and all
        cached reveal indices in one transaction. Sections referenced as reveal points cannot be
        deleted. Titles you haven&apos;t reached are hidden unless spoiler peek is on.
      </p>
      <ErrorNote error={error} />

      {books.map((book) => (
        <Panel key={book.id} className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-lg">
              Book {book.order} · {book.title}
            </h2>
            <form action={deleteBookAction} className="ml-auto">
              <input type="hidden" name="seriesId" value={seriesId} />
              <input type="hidden" name="bookId" value={book.id} />
              <Button variant="ghost" size="sm" title="Delete book (must be empty)">
                <Trash2 className="size-3" />
              </Button>
            </form>
          </div>

          {book.sections.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {book.sections.map((s) => {
                const title = gatedTitle.get(s.id) ?? null;
                const locked = s.title !== null && title === null;
                return (
                  <li key={s.id}>
                    <form
                      action={updateSectionAction}
                      className="flex flex-wrap items-center gap-1.5 text-sm"
                    >
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="sectionId" value={s.id} />
                      <span className="tnum w-8 text-right text-xs text-soft">{s.position}</span>
                      <span className="w-28">{sectionTypeLabel(s)}</span>
                      <Input name="number" type="number" defaultValue={s.number ?? ""} className="w-16" placeholder="#" />
                      {locked ? (
                        <>
                          <input type="hidden" name="titleLocked" value="1" />
                          <span className="flex-1 text-xs italic text-soft">
                            🔒 title hidden — enable spoiler peek to edit
                          </span>
                        </>
                      ) : (
                        <Input name="title" defaultValue={title ?? ""} placeholder="title (gated)" className="w-52 flex-1" />
                      )}
                      <Select name="partId" defaultValue={s.partId ?? ""} className="w-28">
                        <option value="">no part</option>
                        {book.parts.map((p) => (
                          <option key={p.id} value={p.id}>
                            Part {p.number}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="outline" size="sm">Save</Button>
                    </form>
                    <form action={deleteSectionAction} className="ml-8 inline">
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="sectionId" value={s.id} />
                      <button className="text-[11px] text-soft hover:text-danger">remove</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}

          <details className="mb-2">
            <summary className="cursor-pointer text-sm text-accent">Add section</summary>
            <form action={insertSectionAction} className="mt-2 grid gap-2 sm:grid-cols-3">
              <input type="hidden" name="seriesId" value={seriesId} />
              <input type="hidden" name="bookId" value={book.id} />
              <Select name="type" required>
                {SECTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toLowerCase().replace("_", " ")}
                  </option>
                ))}
              </Select>
              <Input name="number" type="number" placeholder="number (per type)" />
              <Input name="title" placeholder="title (gated)" />
              <Select name="partId">
                <option value="">no part</option>
                {book.parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    Part {p.number}
                  </option>
                ))}
              </Select>
              {/* anchors limited to THIS book — cross-book interleavings are rejected server-side */}
              <Select name="afterSectionId" defaultValue={book.sections[book.sections.length - 1]?.id ?? ""}>
                <option value="">at start of book</option>
                {book.sections.map((s) => {
                  const t = gatedTitle.get(s.id);
                  return (
                    <option key={s.id} value={s.id}>
                      after {sectionTypeLabel(s)}
                      {t ? ` — ${t}` : ""}
                    </option>
                  );
                })}
              </Select>
              <Button type="submit" size="sm">Insert</Button>
            </form>
          </details>

          <details>
            <summary className="cursor-pointer text-sm text-accent">Add part</summary>
            <form action={createPartAction} className="mt-2 flex flex-wrap gap-2">
              <input type="hidden" name="seriesId" value={seriesId} />
              <input type="hidden" name="bookId" value={book.id} />
              <Input name="number" type="number" placeholder="number" className="w-24" required />
              <Input name="title" placeholder="part title (gated)" className="w-56" />
              <Button type="submit" size="sm">Add part</Button>
            </form>
            {book.parts.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {book.parts.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span>
                      Part {p.number}
                      {viewer.peek && p.title ? ` — ${p.title}` : ""}
                    </span>
                    <form action={deletePartAction}>
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="partId" value={p.id} />
                      <button className="text-[11px] text-soft hover:text-danger">remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </Panel>
      ))}

      <Panel>
        <h2 className="mb-2 text-lg">Add book</h2>
        <form action={createBookAction} className="flex gap-2">
          <input type="hidden" name="seriesId" value={seriesId} />
          <Input name="title" placeholder="book title" required maxLength={200} />
          <Button type="submit">Add book</Button>
        </form>
      </Panel>
    </div>
  );
}
