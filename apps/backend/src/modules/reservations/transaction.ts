import { randomInt } from "node:crypto";
import { performance } from "node:perf_hooks";
import { MongoError, type ClientSession, type MongoClient } from "mongodb";

export class TransactionUnavailableError extends Error {
  constructor(readonly uncertainCommit = false) {
    super(uncertainCommit ? "The transaction outcome is not yet known. Retry with the same operation key." : "The database could not complete the transaction in time.");
    this.name = "TransactionUnavailableError";
  }
}

export interface TransactionAttempt { readonly session: ClientSession; readonly deadline: number }
export type TransactionWork<T> = (attempt: TransactionAttempt) => Promise<T>;

const TRANSACTION_BUDGET_MS = 5_000;
const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_COMMIT_ATTEMPTS = 3;

export function remainingTransactionMs(deadline: number): number {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw new TransactionUnavailableError();
  return remaining;
}

/** Bounded snapshot transaction with explicit transient retries and unknown-commit retries. */
export async function withBoundedTransaction<T>(client: MongoClient, work: TransactionWork<T>): Promise<T> {
  const session = client.startSession();
  const deadline = performance.now() + TRANSACTION_BUDGET_MS;
  let lastError: unknown;
  try {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      remainingTransactionMs(deadline);
      session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
      try {
        const result = await work({ session, deadline });
        remainingTransactionMs(deadline);
        let commitAttempts = 0;
        for (;;) {
          try {
            remainingTransactionMs(deadline);
            await session.commitTransaction();
            return result;
          } catch (error) {
            if (hasLabel(error, "UnknownTransactionCommitResult")) {
              commitAttempts += 1;
              if (commitAttempts >= MAX_COMMIT_ATTEMPTS || performance.now() >= deadline) throw new TransactionUnavailableError(true);
              await backoff(commitAttempts, deadline);
              continue;
            }
            throw error;
          }
        }
      } catch (error) {
        lastError = error;
        if (error instanceof TransactionUnavailableError && error.uncertainCommit) throw error;
        if (session.inTransaction()) {
          try { await session.abortTransaction(); } catch { /* preserve the original transaction error */ }
        }
        if (error instanceof TransactionUnavailableError) throw error;
        if (!hasLabel(error, "TransientTransactionError") || attempt === MAX_TRANSACTION_ATTEMPTS || performance.now() >= deadline) throw error;
        await backoff(attempt, deadline);
      }
    }
    if (lastError instanceof MongoError && hasLabel(lastError, "UnknownTransactionCommitResult")) throw new TransactionUnavailableError(true);
    throw lastError ?? new TransactionUnavailableError();
  } finally {
    await session.endSession();
  }
}

function hasLabel(error: unknown, label: string): boolean {
  return error instanceof MongoError && error.hasErrorLabel(label);
}

async function backoff(attempt: number, deadline: number): Promise<void> {
  const cap = Math.min(250, 25 * 2 ** Math.max(0, attempt - 1));
  const delay = Math.min(randomInt(10, cap + 1), Math.max(0, remainingTransactionMs(deadline)));
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

