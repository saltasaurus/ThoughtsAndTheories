import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { getViewer, type Viewer } from "@/lib/visibility";

export type SessionUser = { id: string; name: string; email: string };

/** Server-side auth guard: every page and action goes through this or getRequestViewer. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  return { id, name: session.user.name ?? "", email: session.user.email ?? "" };
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
