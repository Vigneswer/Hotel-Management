import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { Database } from "../../infra/database.js";
import { remainingTransactionMs } from "../reservations/transaction.js";
import type { TransactionAttempt } from "../reservations/transaction.js";

export interface AppendAuditInput {
  readonly actorId: string;
  readonly requestId?: string;
  readonly entityType: "RESERVATION" | "ROOM_TYPE";
  readonly entityId: ObjectId;
  readonly action: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly changedFields?: readonly string[];
  readonly reason?: string;
  readonly createdAt: Date;
}

/** Append an audit record with the caller's transaction/session; no hidden transaction is opened. */
export async function appendAuditEvent(database: Database, attempt: TransactionAttempt, input: AppendAuditInput): Promise<void> {
  if (!ObjectId.isValid(input.actorId)) throw new Error("Audit actor ID is invalid.");
  await database.collections.auditEvents.insertOne({
    _id: new ObjectId(), entityType: input.entityType, entityId: input.entityId, actorId: new ObjectId(input.actorId),
    action: input.action,
    ...(input.fromStatus === undefined ? {} : { fromStatus: input.fromStatus }),
    ...(input.toStatus === undefined ? {} : { toStatus: input.toStatus }),
    ...(input.changedFields === undefined ? {} : { changedFields: [...input.changedFields] }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    requestId: input.requestId ?? randomUUID(), createdAt: input.createdAt,
  }, { session: attempt.session, maxTimeMS: remainingTransactionMs(attempt.deadline) });
}
