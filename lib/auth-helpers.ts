import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { getViewer, type Viewer } from "@/lib/visibility";

export type SessionUser = { id: string; name: string; email: string };

/** Server-side auth guard: every page and action goes through this or getRequestViewer. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  // A JWT can outlive its user (a purged account, or a dev DB reset). Verify the
  // row still exists so a ghost session bounces to /login instead of failing a
  // foreign-key check deep inside a mutation. /login re-issues a fresh cookie.
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
  if (!user) redirect("/login");
  return { id: user.id, name: user.name ?? "", email: user.email ?? "" };
}

export const PEEK_COOKIE = "spoiler-peek";

/**
 * The spoiler-peek flag lives on the request context (a cookie) and is read
 * HERE, once — never plumbed through call sites. A READER carrying the flag is
 * rejected by getViewer, per spec.
 */
export async function getRequestViewer(seriesId: string): Promise<Viewer> {
  const user = await requireUser();
  const peek = (await cookies()).get(PEEK_COOKIE)?.value === "1";
  try {
    return await getViewer(user.id, seriesId, peek);
  } catch (e) {
    if (e instanceof NotFoundError) redirect("/"); // not a member of this series
    throw e;
  }
}
