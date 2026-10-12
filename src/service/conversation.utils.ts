import { Prisma } from "@prisma/client";

// Serialises every CONVERSATION write that touches grid positions (create,
// move/swap, preset install) for one family until the transaction ends. An
// advisory lock rather than SELECT ... FOR UPDATE on siblings so that an empty
// page (no rows to lock) is covered too.
export async function lockConversationSection(
  tx: Prisma.TransactionClient,
  familyId: string
) {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(${"conversation:" + familyId}, 0))) AS l`;
}

export function gridSortOrder(gridRow: number, gridCol: number) {
  return gridRow * 100 + gridCol;
}

// Thrown inside a transaction to abort it and map to an HTTP error.
export class HttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error ?? status));
  }
}
