import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createInviteAction, revokeInviteAction } from "@/app/actions/invites";
import { lowerMemberAction } from "@/app/actions/progress";
import { SectionSelect } from "@/components/cards/section-select";
import { ErrorNote } from "@/components/error-note";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getRequestViewer } from "@/lib/auth-helpers";
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
  const [invites, members, options] = await Promise.all([
    isOwner ? listInvites(viewer) : Promise.resolve([]),
    isOwner ? listMembers(viewer) : Promise.resolve([]),
    isOwner ? listSectionOptions(viewer) : Promise.resolve([]),
  ]);

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
        <h2 className="mb-1 text-lg">Export / import</h2>
        <p className="text-sm text-soft">TODO (Phase 3): JSON export and import of a series.</p>
      </Panel>
    </div>
  );
}
