import { randomUUID } from "node:crypto";
import { ObjectId, MongoError, type ClientSession } from "mongodb";
import {
  ExpectedVersionSchema, IdSchema, OperationKeySchema, RoomTypeUpdateSchema, RoomTypeWriteSchema,
  type CommandMeta, type RoomCommands,
} from "@hotel/contracts";
import type { AppConfig } from "../../../config/env.js";
import type { Database, IdempotencyDocument, ReservationDocument, RoomTypeDocument } from "../../../infra/database.js";
import { COMMITTED_STATUSES, calculatePeakOccupancy, type OccupancyInterval } from "../../availability/occupancy.js";
import { hotelCalendarDate } from "../../reservations/policies/dates.js";
import { CommandError, hashRequest, toRoomTypeDto } from "../../reservations/commands.js";
import { TransactionUnavailableError, remainingTransactionMs, withBoundedTransaction, type TransactionAttempt } from "../../reservations/transaction.js";
import { appendAuditEvent } from "../../audit/repository.js";

export interface RoomCommandConfig extends Pick<AppConfig, "HOTEL_TIME_ZONE" | "HOTEL_CURRENCY"> { readonly clock?: () => Date }

export class RoomCommandService implements RoomCommands {
  private readonly clock: () => Date;
  constructor(private readonly database: Database, private readonly config: RoomCommandConfig) { this.clock = config.clock ?? (() => new Date()); }

  async create(raw: Parameters<RoomCommands["create"]>[0]) {
    const meta = this.meta(raw);
    requireStaff(meta);
    const input = RoomTypeWriteSchema.parse(raw.roomType);
    if (input.nightlyPrice.currency !== this.config.HOTEL_CURRENCY) throw new CommandError(400, "VALIDATION_ERROR", "Room type currency must match the configured hotel currency.");
    const operation = "room.create";
    const requestHash = hashRequest({ roomType: input });
    const roomId = new ObjectId(); const now = this.clock();
    const document: RoomTypeDocument = {
      _id: roomId, name: input.name, description: input.description, capacity: input.capacity,
      facilities: [...input.facilities], nightlyPriceMinor: input.nightlyPrice.amountMinor, currency: input.nightlyPrice.currency,
      totalInventory: input.totalInventory, active: true, inventoryVersion: 0, version: 0,
      ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }), createdAt: now, updatedAt: now,
    };
    const actorId = parseId(meta.actor.userId);
    try {
      return await withBoundedTransaction(this.database.client, async (attempt) => {
        // A new type has no shared guard document yet; its insert establishes the guard as the first write.
        await this.database.collections.roomTypes.insertOne(document, txnOptions(attempt));
        const existing = await this.findOperation(attempt, actorId, operation, meta.operationKey);
        if (existing) {
          if (existing.requestHash !== requestHash) throw new CommandError(409, "IDEMPOTENCY_CONFLICT", "This operation key was already used for a different request.");
          throw new IdempotentReplay(existing);
        }
        await appendAuditEvent(this.database, attempt, { actorId: meta.actor.userId, requestId: meta.requestId, entityType: "ROOM_TYPE", entityId: roomId, action: "CREATE", changedFields: ["created"], createdAt: now });
        await this.saveOperation(attempt, meta, operation, requestHash, roomId, now);
        return toRoomTypeDto(document);
      });
    } catch (error) {
      if (error instanceof IdempotentReplay) return this.loadRoom(error.record.resourceId);
      if (!isDuplicateKey(error)) throw mapError(error);
      return this.replayOrThrow(actorId, operation, meta.operationKey, requestHash, error);
    }
  }

  async update(raw: Parameters<RoomCommands["update"]>[0]) {
    const meta = this.meta(raw); requireStaff(meta);
    const roomTypeId = parseId(raw.roomTypeId);
    const parsedPatch = RoomTypeUpdateSchema.parse(raw.patch);
    ExpectedVersionSchema.parse(raw.expectedVersion);
    if (parsedPatch.expectedVersion !== raw.expectedVersion) throw new CommandError(400, "VALIDATION_ERROR", "Expected version values must match.");
    const { expectedVersion: _patchVersion, ...patch } = parsedPatch;
    const fields = Object.keys(patch);
    if (fields.length === 0) throw new CommandError(400, "VALIDATION_ERROR", "At least one room field must be changed.");
    if (patch.nightlyPrice && patch.nightlyPrice.currency !== this.config.HOTEL_CURRENCY) throw new CommandError(400, "VALIDATION_ERROR", "Room type currency must match the configured hotel currency.");
    const operation = "room.update";
    const requestHash = hashRequest({ roomTypeId: roomTypeId.toHexString(), expectedVersion: raw.expectedVersion, patch });
    const actorId = parseId(meta.actor.userId);
    try {
      return await withBoundedTransaction(this.database.client, async (attempt) => {
        const current = await this.acquireGuard(roomTypeId, attempt);
        const existing = await this.findOperation(attempt, actorId, operation, meta.operationKey);
        if (existing) {
          if (existing.requestHash !== requestHash) throw new CommandError(409, "IDEMPOTENCY_CONFLICT", "This operation key was already used for a different request.");
          return this.loadRoom(existing.resourceId, attempt.session, attempt.deadline);
        }
        if (!current) throw new CommandError(404, "NOT_FOUND", "Room type was not found.");
        if (current.version !== raw.expectedVersion) throw new CommandError(409, "VERSION_CONFLICT", "Room type changed; refresh and retry the edit.");
        const today = hotelCalendarDate(this.clock(), this.config.HOTEL_TIME_ZONE);
        if (patch.totalInventory !== undefined && patch.totalInventory < current.totalInventory) {
          await this.assertSafeInventoryReduction(current, patch.totalInventory, today, attempt);
        }
        if (patch.capacity !== undefined && patch.capacity < current.capacity) {
          await this.assertSafeCapacityReduction(current, patch.capacity, today, attempt);
        }
        const set: Partial<RoomTypeDocument> = { updatedAt: this.clock(), version: current.version + 1 };
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.description !== undefined) set.description = patch.description;
        if (patch.capacity !== undefined) set.capacity = patch.capacity;
        if (patch.facilities !== undefined) set.facilities = [...patch.facilities];
        if (patch.nightlyPrice !== undefined) { set.nightlyPriceMinor = patch.nightlyPrice.amountMinor; set.currency = patch.nightlyPrice.currency; }
        if (patch.totalInventory !== undefined) set.totalInventory = patch.totalInventory;
        if (patch.imageUrl !== undefined) set.imageUrl = patch.imageUrl;
        const updated = await this.database.collections.roomTypes.findOneAndUpdate(
          { _id: roomTypeId, version: raw.expectedVersion }, { $set: set }, { ...txnOptions(attempt), returnDocument: "after" },
        );
        if (!updated) throw new CommandError(409, "VERSION_CONFLICT", "Room type changed; refresh and retry the edit.");
        await appendAuditEvent(this.database, attempt, { actorId: meta.actor.userId, requestId: meta.requestId, entityType: "ROOM_TYPE", entityId: roomTypeId, action: "UPDATE", changedFields: fields, createdAt: this.clock() });
        await this.saveOperation(attempt, meta, operation, requestHash, roomTypeId, this.clock());
        return toRoomTypeDto(updated);
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw mapError(error);
      return this.replayOrThrow(actorId, operation, meta.operationKey, requestHash, error);
    }
  }

  async deactivate(raw: Parameters<RoomCommands["deactivate"]>[0]) {
    const meta = this.meta(raw); requireStaff(meta);
    const roomTypeId = parseId(raw.roomTypeId); ExpectedVersionSchema.parse(raw.expectedVersion);
    const operation = "room.deactivate";
    const requestHash = hashRequest({ roomTypeId: roomTypeId.toHexString(), expectedVersion: raw.expectedVersion });
    const actorId = parseId(meta.actor.userId);
    try {
      return await withBoundedTransaction(this.database.client, async (attempt) => {
        const current = await this.acquireGuard(roomTypeId, attempt);
        const existing = await this.findOperation(attempt, actorId, operation, meta.operationKey);
        if (existing) {
          if (existing.requestHash !== requestHash) throw new CommandError(409, "IDEMPOTENCY_CONFLICT", "This operation key was already used for a different request.");
          return this.loadRoom(existing.resourceId, attempt.session, attempt.deadline);
        }
        if (!current) throw new CommandError(404, "NOT_FOUND", "Room type was not found.");
        if (current.version !== raw.expectedVersion) throw new CommandError(409, "VERSION_CONFLICT", "Room type changed; refresh and retry the edit.");
        if (!current.active) throw new CommandError(409, "STATE_CONFLICT", "Room type is already inactive.");
        const now = this.clock();
        const updated = await this.database.collections.roomTypes.findOneAndUpdate(
          { _id: roomTypeId, version: raw.expectedVersion, active: true }, { $set: { active: false, version: current.version + 1, updatedAt: now } },
          { ...txnOptions(attempt), returnDocument: "after" },
        );
        if (!updated) throw new CommandError(409, "VERSION_CONFLICT", "Room type changed; refresh and retry the edit.");
        await appendAuditEvent(this.database, attempt, { actorId: meta.actor.userId, requestId: meta.requestId, entityType: "ROOM_TYPE", entityId: roomTypeId, action: "DEACTIVATE", changedFields: ["active"], createdAt: now });
        await this.saveOperation(attempt, meta, operation, requestHash, roomTypeId, now);
        return toRoomTypeDto(updated);
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw mapError(error);
      return this.replayOrThrow(actorId, operation, meta.operationKey, requestHash, error);
    }
  }

  async activate(raw: Parameters<RoomCommands["activate"]>[0]) {
    const meta = this.meta(raw); requireStaff(meta);
    const roomTypeId = parseId(raw.roomTypeId); ExpectedVersionSchema.parse(raw.expectedVersion);
    const operation = "room.activate";
    const requestHash = hashRequest({ roomTypeId: roomTypeId.toHexString(), expectedVersion: raw.expectedVersion });
    const actorId = parseId(meta.actor.userId);
    try {
      return await withBoundedTransaction(this.database.client, async (attempt) => {
        const current = await this.acquireGuard(roomTypeId, attempt);
        const existing = await this.findOperation(attempt, actorId, operation, meta.operationKey);
        if (existing) {
          if (existing.requestHash !== requestHash) throw new CommandError(409, "IDEMPOTENCY_CONFLICT", "This operation key was already used for a different request.");
          return this.loadRoom(existing.resourceId, attempt.session, attempt.deadline);
        }
        if (!current) throw new CommandError(404, "NOT_FOUND", "Room type was not found.");
        if (current.version !== raw.expectedVersion) throw new CommandError(409, "VERSION_CONFLICT", "Room type changed; refresh and retry the edit.");
        if (current.active) throw new CommandError(409, "STATE_CONFLICT", "Room type is already active.");
        const now = this.clock();
        const updated = await this.database.collections.roomTypes.findOneAndUpdate(
          { _id: roomTypeId, version: raw.expectedVersion, active: false }, { $set: { active: true, version: current.version + 1, updatedAt: now } },
          { ...txnOptions(attempt), returnDocument: "after" },
        );
        if (!updated) throw new CommandError(409, "VERSION_CONFLICT", "Room type changed; refresh and retry the edit.");
        await appendAuditEvent(this.database, attempt, { actorId: meta.actor.userId, requestId: meta.requestId, entityType: "ROOM_TYPE", entityId: roomTypeId, action: "ACTIVATE", changedFields: ["active"], createdAt: now });
        await this.saveOperation(attempt, meta, operation, requestHash, roomTypeId, now);
        return toRoomTypeDto(updated);
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw mapError(error);
      return this.replayOrThrow(actorId, operation, meta.operationKey, requestHash, error);
    }
  }

  private meta(raw: CommandMeta): CommandMeta & { requestId: string } {
    IdSchema.parse(raw.actor.userId); OperationKeySchema.parse(raw.operationKey);
    return { ...raw, requestId: raw.requestId ?? randomUUID() };
  }

  private async acquireGuard(id: ObjectId, attempt: TransactionAttempt): Promise<RoomTypeDocument | null> {
    const result = await this.database.collections.roomTypes.updateOne({ _id: id }, { $inc: { inventoryVersion: 1 } }, txnOptions(attempt));
    if (result.matchedCount !== 1) return null;
    return this.database.collections.roomTypes.findOne({ _id: id }, txnOptions(attempt));
  }

  private async assertSafeInventoryReduction(room: RoomTypeDocument, newInventory: number, today: string, attempt: TransactionAttempt): Promise<void> {
    const currentCheckedIn = await this.database.collections.reservations.countDocuments({ roomTypeId: room._id, status: "CHECKED_IN" }, txnOptions(attempt));
    if (newInventory < currentCheckedIn) throw new CommandError(409, "INVENTORY_UNAVAILABLE", "Inventory cannot be reduced below the number of checked-in rooms.");
    const reservations = await this.database.collections.reservations.find({
      roomTypeId: room._id, status: { $in: COMMITTED_STATUSES }, checkOutDate: { $gt: today },
    }, txnOptions(attempt)).project<Pick<ReservationDocument, "checkInDate" | "checkOutDate" | "roomCount" | "status">>({
      checkInDate: 1, checkOutDate: 1, roomCount: 1, status: 1,
    }).toArray();
    if (reservations.length === 0) return;
    const end = reservations.reduce((latest, reservation) => reservation.checkOutDate > latest ? reservation.checkOutDate : latest, today);
    const peak = calculatePeakOccupancy(today, end, reservations as OccupancyInterval[], newInventory);
    if (peak.peak > newInventory) throw new CommandError(409, "INVENTORY_UNAVAILABLE", "Inventory cannot be reduced below future committed occupancy.");
  }

  private async assertSafeCapacityReduction(room: RoomTypeDocument, newCapacity: number, today: string, attempt: TransactionAttempt): Promise<void> {
    const incompatible = await this.database.collections.reservations.findOne({
      roomTypeId: room._id, guestCount: { $gt: newCapacity }, checkOutDate: { $gt: today },
      status: { $in: ["PENDING", ...COMMITTED_STATUSES] },
    }, { ...txnOptions(attempt), projection: { _id: 1 } });
    if (incompatible) throw new CommandError(409, "STATE_CONFLICT", "Capacity cannot be reduced below an existing future reservation's guest count.");
  }

  private async findOperation(attempt: TransactionAttempt, actorId: ObjectId, operation: string, key: string): Promise<IdempotencyDocument | null> {
    return this.database.collections.idempotencyRecords.findOne({ actorId, operation, key }, txnOptions(attempt));
  }
  private async saveOperation(attempt: TransactionAttempt, meta: CommandMeta, operation: string, requestHash: string, roomTypeId: ObjectId, createdAt: Date): Promise<void> {
    await this.database.collections.idempotencyRecords.insertOne({ _id: new ObjectId(), actorId: parseId(meta.actor.userId), operation, key: meta.operationKey, requestHash, resourceId: roomTypeId, createdAt }, txnOptions(attempt));
  }
  private async loadRoom(id: ObjectId, session?: ClientSession, deadline?: number) {
    const document = await this.database.collections.roomTypes.findOne({ _id: id }, session && deadline !== undefined ? { session, maxTimeMS: remainingTransactionMs(deadline) } : {});
    if (!document) throw new CommandError(409, "STATE_CONFLICT", "The room type result of this operation is no longer available.");
    return toRoomTypeDto(document);
  }
  private async replayOrThrow(actorId: ObjectId, operation: string, key: string, requestHash: string, original: unknown) {
    const record = await this.database.collections.idempotencyRecords.findOne({ actorId, operation, key });
    if (!record) throw original;
    if (record.requestHash !== requestHash) throw new CommandError(409, "IDEMPOTENCY_CONFLICT", "This operation key was already used for a different request.");
    return this.loadRoom(record.resourceId);
  }
}

class IdempotentReplay extends Error { constructor(readonly record: IdempotencyDocument) { super("Idempotent result already exists."); } }

export function createRoomCommandService(database: Database, config: RoomCommandConfig): RoomCommandService { return new RoomCommandService(database, config); }

function requireStaff(meta: CommandMeta): void { if (meta.actor.role !== "STAFF") throw new CommandError(403, "FORBIDDEN", "Staff access is required."); }
function parseId(id: string): ObjectId {
  if (!IdSchema.safeParse(id).success) throw new CommandError(400, "VALIDATION_ERROR", "Identifier is invalid.");
  return new ObjectId(id);
}
function txnOptions(attempt: TransactionAttempt): { session: ClientSession; maxTimeMS: number } { return { session: attempt.session, maxTimeMS: remainingTransactionMs(attempt.deadline) }; }
function isDuplicateKey(error: unknown): boolean { return error instanceof MongoError && error.code === 11000; }
function mapError(error: unknown): unknown { return error instanceof TransactionUnavailableError ? new CommandError(503, "SERVICE_UNAVAILABLE", error.message) : error; }
