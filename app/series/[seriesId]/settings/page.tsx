import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { importSeriesAction } from "@/app/actions/export-import";
import { createInviteAction, revokeInviteAction } from "@/app/actions/invites";
import { lowerMemberAction } from "@/app/actions/progress";
import { createTokenAction, dismissTokenAction, revokeTokenAction } from "@/app/actions/tokens";
import { SectionSelect } from "@/components/cards/section-select";
import { ErrorNote } from "@/components/error-note";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getRequestViewer } from "@/lib/auth-helpers";
import { NEW_TOKEN_COOKIE, listApiTokens } from "@/lib/services/api-tokens";
import { listInvites } from "@/lib/services/invites";
import { listMembers } from "@/lib/services/memberships";
import { listSectionOptions } from "@/lib/visibility";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { seriesId } = await params;
  const { error } = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  if (viewer.role === "READER") redirect(`/series/${seriesId}/cards`);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  const isOwner = viewer.role === "OWNER";
  const [invites, members, options, tokens] = await Promise.all([
    isOwner ? listInvites(viewer) : Promise.resolve([]),
    isOwner ? listMembers(viewer) : Promise.resolve([]),
    isOwner ? listSectionOptions(viewer) : Promise.resolve([]),
    listApiTokens(viewer.userId),
  ]);
  // Set by createTokenAction and displayed exactly once.
  const newToken = (await cookies()).get(NEW_TOKEN_COOKIE)?.value ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl">Settings</h1>
      <ErrorNote error={error} />

      <Panel>
        <h2 className="mb-2 text-lg">Create invite</h2>
        <form action={createInviteAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="seriesId" value={seriesId} />
          <div>
            <Label>Role</Label>
            <Select name="role" defaultValue="READER" className="w-32">
              <option value="READER">Reader</option>
              {isOwner && <option value="EDITOR">Editor</option>}
            </Select>
          </div>
          <div>
            <Label>Expires</Label>
            <Input name="expiresAt" type="datetime-local" className="w-52" />
          </div>
          <div>
            <Label>Max uses</Label>
            <Input name="maxUses" type="number" min={1} className="w-24" />
          </div>
          <Button type="submit">Create invite link</Button>
        </form>
        {!isOwner && (
          <p className="mt-1 text-[11px] text-soft">Editors can create reader invites only.</p>
        )}
      </Panel>

      {isOwner && (
        <Panel>
          <h2 className="mb-2 text-lg">Invites</h2>
          {invites.length === 0 ? (
            <p className="text-sm text-soft">No invites yet.</p>
          ) : (
            <ul className="space-y-2">
              {invites.map((inv) => {
                const spent = inv.maxUses !== null && inv.useCount >= inv.maxUses;
                const expired = inv.expiresAt !== null && inv.expiresAt <= new Date();
                const state = inv.revokedAt ? "revoked" : expired ? "expired" : spent ? "exhausted" : "active";
                return (
                  <li key={inv.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      readOnly
                      value={`${baseUrl}/join/${inv.code}`}
                      className="w-full max-w-md flex-1 rounded-md border border-line bg-raised px-2 py-1 text-xs"
                    />
                    <span className="text-[11px] uppercase text-soft">{inv.role.toLowerCase()}</span>
                    <span className="tnum text-[11px] text-soft">
                      {inv.useCount}
                      {inv.maxUses !== null ? `/${inv.maxUses}` : ""} uses
                    </span>
                    <span
                      className={`text-[11px] ${state === "active" ? "text-location" : "text-danger"}`}
                    >
                      {state}
                    </span>
                    {state === "active" && (
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="seriesId" value={seriesId} />
                        <input type="hidden" name="inviteId" value={inv.id} />
                        <Button variant="outline" size="sm">Revoke</Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {isOwner && (
        <Panel>
          <h2 className="mb-2 text-lg">Members</h2>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-40">{m.name}</span>
                <span className="text-[11px] uppercase text-soft">{m.role.toLowerCase()}</span>
                {m.userId !== viewer.userId && (
                  <form action={lowerMemberAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="userId" value={m.userId} />
                    <SectionSelect name="sectionId" options={options} emptyLabel="series start" />
                    <Button variant="outline" size="sm" title="Progress can only be lowered — it's a claim about what they've read">
                      Lower
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-soft">
            You can only LOWER a member&apos;s progress (e.g. set back an accidental skip). Raising
            it is theirs alone.
          </p>
        </Panel>
      )}

      <Panel>
        <h2 className="mb-1 text-lg">API tokens</h2>
        <p className="mb-2 text-xs text-soft">
          Tokens authenticate the v1 REST API as <em>you</em>: they carry exactly your memberships
          and your reading position, and never get spoiler peek. A token is shown once, at
          creation — store it somewhere safe.
        </p>

        {newToken && (
          <div className="mb-3 rounded-md border border-accent bg-raised p-2">
            <p className="mb-1 text-xs text-accent">
              Copy this now — it will not be shown again.
            </p>
            <input
              readOnly
              value={newToken}
              className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs"
            />
            <form action={dismissTokenAction} className="mt-2">
              <input type="hidden" name="seriesId" value={seriesId} />
              <Button variant="outline" size="sm">
                I&apos;ve saved it
              </Button>
            </form>
          </div>
        )}

        <form action={createTokenAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="seriesId" value={seriesId} />
          <div>
            <Label>Label</Label>
            <Input name="label" placeholder="laptop script" className="w-52" required />
          </div>
          <Button type="submit">Create token</Button>
        </form>

        {tokens.length > 0 && (
          <ul className="mt-3 space-y-1">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-44">{t.label}</span>
                <span className="text-[11px] text-soft">
                  {t.revokedAt
                    ? "revoked"
                    : t.lastUsedAt
                      ? `last used ${t.lastUsedAt.toLocaleDateString()}`
                      : "never used"}
                </span>
                {!t.revokedAt && (
                  <form action={revokeTokenAction}>
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="tokenId" value={t.id} />
                    <Button variant="outline" size="sm">
                      Revoke
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {isOwner && (
        <Panel>
          <h2 className="mb-1 text-lg">Export / import</h2>
          <p className="mb-2 text-xs text-soft">
            Export writes the whole series — structure, cards, fields, relations, timeline,
            calendar and templates — as JSON, <strong>ungated</strong>, as a backup. It deliberately
            excludes memberships, sessions, reading positions, invites and revision history: those
            are specific to this instance, and revision diffs are never exported.
          </p>
          <p className="mb-3 text-xs text-soft">
            Importing always creates a <strong>new</strong> series that you own. It never writes
            into this one.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <a
              href={`/series/${seriesId}/export`}
              className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm hover:border-accent"
            >
              Download JSON
            </a>
            <form action={importSeriesAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="seriesId" value={seriesId} />
              <div>
                <Label>Import a series file</Label>
                <input
                  type="file"
                  name="file"
                  accept="application/json,.json"
                  className="block text-xs text-soft file:mr-2 file:rounded-md file:border file:border-line file:bg-raised file:px-2 file:py-1 file:text-xs"
                  required
                />
              </div>
              <Button variant="outline">Import as new series</Button>
            </form>
          </div>
        </Panel>
      )}
    </div>
  );
}
