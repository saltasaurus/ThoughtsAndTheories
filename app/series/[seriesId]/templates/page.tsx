import { redirect } from "next/navigation";
import {
  addFieldAction,
  moveFieldAction,
  restoreFieldAction,
  retireFieldAction,
  updateFieldAction,
} from "@/app/actions/templates";
import { ErrorNote } from "@/components/error-note";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getRequestViewer } from "@/lib/auth-helpers";
import { listTemplates } from "@/lib/services/templates";

const FIELD_TYPES = [
  "TEXT",
  "RICHTEXT",
  "NUMBER",
  "INWORLD_DATE",
  "SELECT",
  "MULTISELECT",
  "CARD_REF",
  "IMAGE_URL",
] as const;

const HAS_CHOICES = new Set<string>(["SELECT", "MULTISELECT"]);

export default async function TemplatesPage({
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

  const templates = await listTemplates(viewer);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl">Templates</h1>
      <p className="text-xs text-soft">
        Fields define what a card of each type can hold. Editing a template never rewrites existing
        cards — it changes what new cards are offered. Card types themselves are fixed by the schema.
      </p>
      <ErrorNote error={error} />

      {templates.map((t) => (
        <Panel key={t.id}>
          <h2 className="mb-2 text-lg capitalize">{t.cardType.toLowerCase()}</h2>

          <ul className="space-y-2">
            {t.fields.map((f, i) => {
              const locked = f.valueCount > 0;
              return (
                <li key={f.id} className="rounded-md border border-line p-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <form action={updateFieldAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="fieldId" value={f.id} />
                      <div>
                        <Label>Label</Label>
                        <Input name="label" defaultValue={f.label} className="w-44" />
                      </div>
                      <div>
                        <Label>Type</Label>
                        {locked ? (
                          <div
                            className="flex h-9 items-center px-1 text-sm text-soft"
                            title={`${f.valueCount} card(s) already store a value — retyping would invalidate them`}
                          >
                            {f.fieldType.toLowerCase()} · locked
                          </div>
                        ) : (
                          <Select name="fieldType" defaultValue={f.fieldType} className="w-36">
                            {FIELD_TYPES.map((ft) => (
                              <option key={ft} value={ft}>
                                {ft.toLowerCase()}
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                      {HAS_CHOICES.has(f.fieldType) && (
                        <div>
                          <Label>Choices (comma-separated)</Label>
                          <Input
                            name="choices"
                            defaultValue={(f.options?.choices ?? []).join(", ")}
                            className="w-56"
                          />
                        </div>
                      )}
                      <div>
                        <Label>Default reveal</Label>
                        <Select
                          name="defaultRevealBehavior"
                          defaultValue={f.defaultRevealBehavior}
                          className="w-36"
                        >
                          <option value="CARD">same as card</option>
                          <option value="SERIES_START">series start</option>
                        </Select>
                      </div>
                      <label className="flex h-9 items-center gap-1 text-xs text-soft">
                        <input type="checkbox" name="required" defaultChecked={f.required} />
                        required
                      </label>
                      <Button size="sm">Save</Button>
                    </form>

                    <form action={moveFieldAction}>
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="fieldId" value={f.id} />
                      <input type="hidden" name="direction" value="up" />
                      <Button variant="outline" size="sm" disabled={i === 0} title="Move up">
                        ↑
                      </Button>
                    </form>
                    <form action={moveFieldAction}>
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="fieldId" value={f.id} />
                      <input type="hidden" name="direction" value="down" />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={i === t.fields.length - 1}
                        title="Move down"
                      >
                        ↓
                      </Button>
                    </form>
                    <form action={retireFieldAction}>
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="fieldId" value={f.id} />
                      <Button
                        variant="outline"
                        size="sm"
                        title="Hide from card forms; stored values are kept"
                      >
                        Retire
                      </Button>
                    </form>
                  </div>
                  <p className="mt-1 text-[11px] text-soft">
                    key <code>{f.key}</code>
                    {f.valueCount > 0 && ` · ${f.valueCount} card(s) store a value`}
                  </p>
                </li>
              );
            })}
          </ul>

          <form
            action={addFieldAction}
            className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
          >
            <input type="hidden" name="seriesId" value={seriesId} />
            <input type="hidden" name="templateId" value={t.id} />
            <div>
              <Label>Key</Label>
              <Input name="key" placeholder="epithet" className="w-32" required />
            </div>
            <div>
              <Label>Label</Label>
              <Input name="label" placeholder="Epithet" className="w-40" required />
            </div>
            <div>
              <Label>Type</Label>
              <Select name="fieldType" defaultValue="TEXT" className="w-36">
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft.toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Choices (select types)</Label>
              <Input name="choices" placeholder="Alive, Dead" className="w-44" />
            </div>
            <div>
              <Label>Default reveal</Label>
              <Select name="defaultRevealBehavior" defaultValue="CARD" className="w-36">
                <option value="CARD">same as card</option>
                <option value="SERIES_START">series start</option>
              </Select>
            </div>
            <label className="flex h-9 items-center gap-1 text-xs text-soft">
              <input type="checkbox" name="required" />
              required
            </label>
            <Button size="sm">Add field</Button>
          </form>

          {t.retired.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <p className="mb-1 text-[11px] uppercase text-soft">Retired</p>
              <ul className="space-y-1">
                {t.retired.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className="w-40">{r.label}</span>
                    <span className="text-[11px] text-soft">
                      {r.fieldType.toLowerCase()} · <code>{r.key}</code>
                    </span>
                    <form action={restoreFieldAction}>
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="fieldId" value={r.id} />
                      <Button variant="outline" size="sm">
                        Restore
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}
