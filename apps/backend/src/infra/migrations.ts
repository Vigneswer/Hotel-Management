import type { Db, Document, IndexSpecification } from "mongodb";
import type { MigrationDocument } from "./database.js";

const numberType = ["int", "long", "double"];
const dateOnly = { bsonType: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" };
const requiredString = (maxLength: number) => ({ bsonType: "string", minLength: 1, maxLength });
const schema = (required: string[], properties: Document): Document => ({ $jsonSchema: { bsonType: "object", required: ["_id", ...required], additionalProperties: false, properties: { _id: { bsonType: "objectId" }, ...properties } } });

const collectionSchemas: Record<string, Document> = {
  users: schema(["name", "emailNormalized", "passwordHash", "role", "active", "createdAt", "updatedAt"], { name: requiredString(100), emailNormalized: { bsonType: "string", minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, passwordHash: requiredString(512), role: { enum: ["GUEST", "STAFF"] }, active: { bsonType: "bool" }, createdAt: { bsonType: "date" }, updatedAt: { bsonType: "date" } }),
  roomTypes: schema(["name", "description", "capacity", "facilities", "nightlyPriceMinor", "currency", "totalInventory", "active", "inventoryVersion", "version", "createdAt", "updatedAt"], { name: requiredString(100), description: { bsonType: "string", maxLength: 2000 }, capacity: { bsonType: numberType, minimum: 1, maximum: 1000 }, facilities: { bsonType: "array", maxItems: 30, items: requiredString(60) }, nightlyPriceMinor: { bsonType: numberType, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, currency: { bsonType: "string", pattern: "^[A-Z]{3}$" }, totalInventory: { bsonType: numberType, minimum: 0, maximum: 10000 }, active: { bsonType: "bool" }, imageUrl: { bsonType: "string", maxLength: 2048 }, inventoryVersion: { bsonType: numberType, minimum: 0 }, version: { bsonType: numberType, minimum: 0 }, createdAt: { bsonType: "date" }, updatedAt: { bsonType: "date" } }),
  reservations: schema(["reference", "guestId", "roomTypeId", "roomTypeNameSnapshot", "checkInDate", "checkOutDate", "guestCount", "roomCount", "nightCount", "nightlyPriceMinor", "currency", "totalMinor", "status", "version", "createdAt", "updatedAt"], { reference: { bsonType: "string", minLength: 6, maxLength: 32 }, guestId: { bsonType: "objectId" }, roomTypeId: { bsonType: "objectId" }, roomTypeNameSnapshot: requiredString(100), checkInDate: dateOnly, checkOutDate: dateOnly, guestCount: { bsonType: numberType, minimum: 1, maximum: 1000 }, roomCount: { bsonType: numberType, enum: [1] }, nightCount: { bsonType: numberType, minimum: 1, maximum: 30 }, nightlyPriceMinor: { bsonType: numberType, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, currency: { bsonType: "string", pattern: "^[A-Z]{3}$" }, totalMinor: { bsonType: numberType, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, status: { enum: ["PENDING", "CONFIRMED", "CANCELLED", "CHECKED_IN", "CHECKED_OUT"] }, version: { bsonType: numberType, minimum: 0 }, confirmedAt: { bsonType: "date" }, checkedInAt: { bsonType: "date" }, checkedOutAt: { bsonType: "date" }, cancelledAt: { bsonType: "date" }, cancelledBy: { bsonType: "objectId" }, cancellationReason: { bsonType: "string", maxLength: 500 }, createdAt: { bsonType: "date" }, updatedAt: { bsonType: "date" } }),
  sessions: schema(["tokenHash", "userId", "createdAt", "expiresAt"], { tokenHash: { bsonType: "string", pattern: "^[a-f0-9]{64}$" }, userId: { bsonType: "objectId" }, createdAt: { bsonType: "date" }, expiresAt: { bsonType: "date" }, revokedAt: { bsonType: "date" } }),
  idempotencyRecords: schema(["actorId", "operation", "key", "requestHash", "resourceId", "createdAt"], { actorId: { bsonType: "objectId" }, operation: requiredString(80), key: { bsonType: "string", minLength: 16, maxLength: 128 }, requestHash: { bsonType: "string", pattern: "^[a-f0-9]{64}$" }, resourceId: { bsonType: "objectId" }, createdAt: { bsonType: "date" } }),
  auditEvents: schema(["entityType", "entityId", "actorId", "action", "requestId", "createdAt"], { entityType: { enum: ["RESERVATION", "ROOM_TYPE"] }, entityId: { bsonType: "objectId" }, actorId: { bsonType: "objectId" }, action: requiredString(80), fromStatus: { bsonType: "string", maxLength: 30 }, toStatus: { bsonType: "string", maxLength: 30 }, changedFields: { bsonType: "array", maxItems: 40, items: requiredString(80) }, reason: { bsonType: "string", maxLength: 500 }, requestId: requiredString(100), createdAt: { bsonType: "date" } }),
  schemaMigrations: { $jsonSchema: { bsonType: "object", required: ["_id", "appliedAt"], additionalProperties: false, properties: { _id: { bsonType: "string", minLength: 1, maxLength: 120 }, appliedAt: { bsonType: "date" } } } },
};

const indexes: Record<string, Array<{ key: IndexSpecification; options?: Document }>> = {
  users: [{ key: { emailNormalized: 1 }, options: { unique: true, name: "uq_users_email_normalized" } }],
  roomTypes: [{ key: { active: 1, name: 1, _id: 1 }, options: { name: "ix_room_types_active_name_id" } }],
  reservations: [
    { key: { reference: 1 }, options: { unique: true, name: "uq_reservations_reference" } },
    { key: { guestId: 1, createdAt: -1, _id: -1 }, options: { name: "ix_reservations_guest_created" } },
    { key: { status: 1, createdAt: -1, _id: -1 }, options: { name: "ix_reservations_status_created" } },
    { key: { createdAt: -1, _id: -1 }, options: { name: "ix_reservations_created" } },
    { key: { roomTypeId: 1, status: 1, checkOutDate: 1, checkInDate: 1 }, options: { name: "ix_reservations_overlap" } },
    { key: { checkInDate: 1, status: 1, _id: 1 }, options: { name: "ix_reservations_arrivals" } },
    { key: { checkOutDate: 1, status: 1, _id: 1 }, options: { name: "ix_reservations_departures" } },
  ],
  sessions: [
    { key: { tokenHash: 1 }, options: { unique: true, name: "uq_sessions_token_hash" } },
    { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: "ttl_sessions_expiry" } },
  ],
  idempotencyRecords: [{ key: { actorId: 1, operation: 1, key: 1 }, options: { unique: true, name: "uq_idempotency_actor_operation_key" } }],
  auditEvents: [{ key: { entityType: 1, entityId: 1, createdAt: -1 }, options: { name: "ix_audit_entity_created" } }],
  schemaMigrations: [],
};

export const MIGRATION_VERSION = "001_initial_collections_and_indexes";

async function ensureCollectionAndValidator(db: Db, name: string, validator: Document): Promise<void> {
  const existing = await db.listCollections({ name }, { nameOnly: true }).hasNext();
  if (!existing) await db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
  else await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
}

export async function applyMigrations(db: Db): Promise<{ applied: string[] }> {
  const applied: string[] = [];
  for (const [name, validator] of Object.entries(collectionSchemas)) await ensureCollectionAndValidator(db, name, validator);
  for (const [collectionName, collectionIndexes] of Object.entries(indexes)) {
    for (const index of collectionIndexes) await db.collection(collectionName).createIndex(index.key, index.options);
  }
  const migrations = db.collection<MigrationDocument>("schemaMigrations");
  const recorded = await migrations.findOne({ _id: MIGRATION_VERSION });
  if (!recorded) {
    await migrations.insertOne({ _id: MIGRATION_VERSION, appliedAt: new Date() });
    applied.push(MIGRATION_VERSION);
  }
  return { applied };
}
