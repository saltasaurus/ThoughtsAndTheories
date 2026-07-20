import type { Role } from "@prisma/client";
import { ForbiddenError } from "@/lib/errors";

export function requireEditor(role: Role): void {
  if (role !== "OWNER" && role !== "EDITOR") {
    throw new ForbiddenError("Requires editor permission");
  }
}

export function requireOwner(role: Role): void {
  if (role !== "OWNER") {
    throw new ForbiddenError("Requires owner permission");
  }
}
