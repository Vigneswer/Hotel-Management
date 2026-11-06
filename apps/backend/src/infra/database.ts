import { MongoClient, type ClientSession, type Collection, type Db, type Document, type MongoClientOptions, type ObjectId } from "mongodb";
import type { AppConfig } from "../config/env.js";
import type { Role, ReservationStatus } from "@hotel/contracts";

export interface UserDocument extends Document { _id: ObjectId; name: string; emailNormalized: string; passwordHash: string; role: Role; active: boolean; createdAt: Date; updatedAt: Date }
export interface RoomTypeDocument extends Document { _id: ObjectId; name: string; description: string; capacity: number; facilities: string[]; nightlyPriceMinor: number; currency: string; totalInventory: number; active: boolean; imageUrl?: string; inventoryVersion: number; version: number; createdAt: Date; updatedAt: Date }
export interface ReservationDocument extends Document { _id: ObjectId; reference: string; guestId: ObjectId; roomTypeId: ObjectId; roomTypeNameSnapshot: string; checkInDate: string; checkOutDate: string; guestCount: number; roomCount: number; nightCount: number; nightlyPriceMinor: number; currency: string; totalMinor: number; status: ReservationStatus; version: number; confirmedAt?: Date; checkedInAt?: Date; checkedOutAt?: Date; cancelledAt?: Date; cancelledBy?: ObjectId; cancellationReason?: string; createdAt: Date; updatedAt: Date }
export interface SessionDocument extends Document { _id: ObjectId; tokenHash: string; userId: ObjectId; createdAt: Date; expiresAt: Date; revokedAt?: Date }
export interface IdempotencyDocument extends Document { _id: ObjectId; actorId: ObjectId; operation: string; key: string; requestHash: string; resourceId: ObjectId; createdAt: Date }
export interface AuditEventDocument extends Document { _id: ObjectId; entityType: string; entityId: ObjectId; actorId: ObjectId; action: string; fromStatus?: string; toStatus?: string; changedFields?: string[]; reason?: string; requestId: string; createdAt: Date }
export interface MigrationDocument extends Document { _id: string; appliedAt: Date }
export interface DbCollections {
  users: Collection<UserDocument>;
  roomTypes: Collection<RoomTypeDocument>;
  reservations: Collection<ReservationDocument>;
  sessions: Collection<SessionDocument>;
  auditEvents: Collection<AuditEventDocument>;
  idempotencyRecords: Collection<IdempotencyDocument>;
  schemaMigrations: Collection<MigrationDocument>;
}
export interface TransactionContext { readonly session: ClientSession }
export interface Database { readonly client: MongoClient; readonly db: Db; readonly collections: DbCollections; close(): Promise<void> }

function typedCollections(db: Db): DbCollections {
  return {
    users: db.collection<UserDocument>("users"), roomTypes: db.collection<RoomTypeDocument>("roomTypes"),
    reservations: db.collection<ReservationDocument>("reservations"), sessions: db.collection<SessionDocument>("sessions"),
    auditEvents: db.collection<AuditEventDocument>("auditEvents"), idempotencyRecords: db.collection<IdempotencyDocument>("idempotencyRecords"),
    schemaMigrations: db.collection<MigrationDocument>("schemaMigrations"),
  };
}

export async function connectDatabase(config: Pick<AppConfig, "MONGODB_URI" | "MONGODB_DATABASE" | "MONGODB_MAX_POOL_SIZE" | "MONGODB_SERVER_SELECTION_TIMEOUT_MS" | "MONGODB_WAIT_QUEUE_TIMEOUT_MS">): Promise<Database> {
  const options: MongoClientOptions = { appName: "hotel-management-api", maxPoolSize: config.MONGODB_MAX_POOL_SIZE, minPoolSize: 0, maxConnecting: 4, waitQueueTimeoutMS: config.MONGODB_WAIT_QUEUE_TIMEOUT_MS, serverSelectionTimeoutMS: config.MONGODB_SERVER_SELECTION_TIMEOUT_MS, connectTimeoutMS: 5_000, retryWrites: true };
  const client = new MongoClient(config.MONGODB_URI, options);
  try {
    await client.connect();
    const db = client.db(config.MONGODB_DATABASE);
    const hello = await db.admin().command({ hello: 1 });
    if (typeof hello.setName !== "string" || hello.isWritablePrimary !== true) throw new Error("MongoDB must be a writable replica set primary; standalone MongoDB is unsupported.");
    await db.command({ ping: 1 });
    return { client, db, collections: typedCollections(db), close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}

/** Owns a driver session and always ends it. Business retry policy remains with the command owner. */
export async function withTransaction<T>(client: MongoClient, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = client.startSession();
  let result: T | undefined;
  try {
    await session.withTransaction(async () => { result = await work(session); return result; });
    if (result === undefined) throw new Error("Transaction completed without producing a result.");
    return result;
  } finally {
    await session.endSession();
  }
}
