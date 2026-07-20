import type { Prisma, RevisionEntityType } from "@prisma/client";

/**
 * Append a revision row. Diffs contain gated values, so the revealIndex snapshot
 * gates every later read (see lib/visibility.ts listRevisions).
 */
export async function writeRevision(
  tx: Prisma.TransactionClient,
  input: {
    entityType: RevisionEntityType;
    entityId: string;
    userId: string;
    diff: Prisma.InputJsonValue;
    revealIndex: number;
  },
): Promise<void> {
  await tx.revision.create({ data: input });
}
