import { randomBytes } from "node:crypto";
import { Prisma, type InviteRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Viewer } from "@/lib/visibility";

export async function createInvite(
  viewer: Viewer,
  input: { role: InviteRole; expiresAt?: Date | null; maxUses?: number | null },
): Promise<{ id: string; code: string }> {
  // OWNER may mint any invite; EDITOR only READER-role invites.
  if (viewer.role === "READER") throw new ForbiddenError();
  if (viewer.role === "EDITOR" && input.role !== "READER") {
    throw new ForbiddenError("Editors may only create reader invites");
  }
  const invite = await prisma.invite.create({
    data: {
      seriesId: viewer.seriesId,
      code: randomBytes(18).toString("base64url"),
      role: input.role,
      createdById: viewer.userId,
      expiresAt: input.expiresAt ?? null,
      maxUses: input.maxUses ?? null,
    },
  });
  return { id: invite.id, code: invite.code };
}

export async function revokeInvite(viewer: Viewer, inviteId: string): Promise<void> {
  if (viewer.role !== "OWNER") throw new ForbiddenError("Requires owner permission");
  const invite = await prisma.invite.findFirst({
    where: { id: inviteId, seriesId: viewer.seriesId, revokedAt: null },
  });
  if (!invite) throw new NotFoundError("Invite not found");
  await prisma.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
}

export type InviteInfo = {
  seriesId: string;
  seriesTitle: string;
  role: InviteRole;
};

/** Look up an invite for display on /join/<code>. Throws if not currently redeemable. */
export async function getValidInvite(code: string): Promise<InviteInfo> {
  const invite = await prisma.invite.findUnique({
    where: { code },
    include: { series: { select: { id: true, title: true } } },
  });
  if (!invite) throw new NotFoundError("Invite not found");
  if (invite.revokedAt) throw new AppError("This invite has been revoked", 410);
  if (invite.expiresAt && invite.expiresAt <= new Date()) {
    throw new AppError("This invite has expired", 410);
  }
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    throw new AppError("This invite has no uses left", 410);
  }
  return { seriesId: invite.series.id, seriesTitle: invite.series.title, role: invite.role };
}

/**
 * Atomically consume one use and add the membership. The claim is a single
 * conditional UPDATE so two concurrent redemptions cannot oversubscribe.
 */
async function claimInvite(
  tx: Prisma.TransactionClient,
  code: string,
  userId: string,
): Promise<{ seriesId: string }> {
  const probe = await tx.invite.findUnique({ where: { code }, select: { seriesId: true } });
  if (!probe) throw new NotFoundError("Invite not found");
  const existing = await tx.membership.findUnique({
    where: { userId_seriesId: { userId, seriesId: probe.seriesId } },
  });
  if (existing) return { seriesId: probe.seriesId }; // already a member; consume nothing

  const claimed = await tx.$queryRaw<Array<{ seriesId: string; role: InviteRole }>>`
    UPDATE "Invite" SET "useCount" = "useCount" + 1
    WHERE "code" = ${code}
      AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > now())
      AND ("maxUses" IS NULL OR "useCount" < "maxUses")
    RETURNING "seriesId", "role"`;
  const claim = claimed[0];
  if (!claim) throw new AppError("This invite is no longer valid", 410);

  // New members start at the series start (revealIndex 0 — before any section)
  // and are prompted to set their real position on first run.
  await tx.membership.create({
    data: {
      userId,
      seriesId: claim.seriesId,
      role: claim.role,
      currentSectionId: null,
      revealIndex: 0,
    },
  });
  return { seriesId: claim.seriesId };
}

export async function redeemInvite(code: string, userId: string): Promise<{ seriesId: string }> {
  return prisma.$transaction((tx) => claimInvite(tx, code, userId));
}

export async function listInvites(viewer: Viewer): Promise<
  Array<{
    id: string;
    code: string;
    role: InviteRole;
    expiresAt: Date | null;
    maxUses: number | null;
    useCount: number;
    revokedAt: Date | null;
    createdAt: Date;
  }>
> {
  if (viewer.role !== "OWNER") throw new ForbiddenError("Requires owner permission");
  return prisma.invite.findMany({
    where: { seriesId: viewer.seriesId },
    select: {
      id: true,
      code: true,
      role: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

// ---------- registration (closed — invite-gated, except first-account bootstrap) ----------

export async function isBootstrap(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

/**
 * Registration is ONLY reachable with a valid invite — except the very first
 * account (empty User table), which bootstraps without one.
 *
 * One transaction end to end: the account and the invite claim commit (or
 * fail) together, so a lost claim race never leaves an orphaned account on a
 * closed-registration instance. An advisory lock serializes the bootstrap
 * check — two concurrent registrations on an empty database cannot both
 * qualify as "the first account".
 */
export async function registerUser(input: {
  email: string;
  name: string;
  password: string;
  inviteCode?: string;
}): Promise<{ userId: string; seriesId: string | null }> {
  const passwordHash = await bcrypt.hash(input.password, 12); // slow — hash outside the tx
  const code = input.inviteCode;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727274)`; // registration mutex
    const bootstrap = (await tx.user.count()) === 0;
    if (!bootstrap && !code) {
      throw new ForbiddenError("Registration requires an invite");
    }
    let userId: string;
    try {
      const user = await tx.user.create({
        data: { email: input.email.toLowerCase(), name: input.name, passwordHash },
      });
      userId = user.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictError("An account with this email already exists");
      }
      throw e;
    }
    if (!bootstrap && code) {
      const { seriesId } = await claimInvite(tx, code, userId);
      return { userId, seriesId };
    }
    return { userId, seriesId: null };
  });
}

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? { id: user.id, email: user.email, name: user.name } : null;
}
