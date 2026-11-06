import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ObjectId, MongoError, type ClientSession, type Filter } from "mongodb";
import {
  CancelReservationRequestSchema, CreateReservationRequestSchema, ExpectedVersionSchema, IdSchema,
  OperationKeySchema, type Actor, type CommandMeta, type ReservationCommands, type ReservationDto,
  type ReservationStatus,
} from "@hotel/contracts";
import type { AppConfig } from "../../config/env.js";
import type { Database, IdempotencyDocument, ReservationDocument, RoomTypeDocument } from "../../infra/database.js";
import { calculateRoomTotal } from "./policies/pricing.js";
import { assertArrivalWindow, hotelCalendarDate, validateStay } from "./policies/dates.js";
import { assertCancellationActor, canCancelReservation, canCheckIn, canCheckOut, canConfirmReservation } from "./policies/lifecycle.js";
import { calculatePeakOccupancy, COMMITTED_STATUSES, type OccupancyInterval } from "../availability/occupancy.js";
import { appendAuditEvent } from "../audit/repository.js";
import { TransactionUnavailableError, remainingTransactionMs, withBoundedTransaction, type TransactionAttempt } from "./transaction.js";

export class CommandError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 503, readonly code: string, message: string) {
    super(message);
    this.name = "CommandError";
  }
}

export interface ReservationCommandConfig extends Pick<AppConfig, "HOTEL_TIME_ZONE" | "HOTEL_CURRENCY"> { readonly clock?: () => Date }

export class ReservationCommandService implements ReservationCommands {
  private readonly clock: () => Date;
  constructor(private readonly database: Database, private readonly config: ReservationCommandConfig) {
    this.clock = config.clock ?? (() => new Date());
  }

  async createPending(raw: Parameters<ReservationCommands["createPending"]>[0]): Promise<ReservationDto> {
    const input = CreateReservationRequestSchema.parse({
      roomTypeId: raw.roomTypeId, checkInDate: raw.checkInDate, checkOutDate: raw.checkOutDate,
      guestCount: raw.guestCount, quoteVersion: raw.quoteVersion,
    });
    const meta = commandMeta(raw);
    if (meta.actor.role !== "GUEST") throw new CommandError(403, "FORBIDDEN", "Only a guest can create a reservation request.");
    const roomTypeId = parseId(input.roomTypeId);
    const nights = validateStay(input.checkInDate, input.checkOutDate);
    const now = this.clock();
    const operation = "reservation.createPending";
    const requestHash = hashRequest({ roomTypeId: roomTypeId.toHexString(), checkInDate: input.checkInDate, checkOutDate: input.checkOutDate, guestCount: input.guestCount, quoteVersion: input.quoteVersion });
    const reservationId = new ObjectId();
    const reference = `HTL-${randomBytes(6).toString("hex").toUpperCase()}`;
    const guestId = parseId(meta.actor.userId);

    return this.runIdempotent(meta, operation, requestHash, roomTypeId, async (attempt, existing, guardedRoom) => {
      if (existing) return this.loadReservation(existing.resourceId, attempt.session, attempt.deadline);
      const room = guardedRoom;
      if (!room) throw new CommandError(404, "NOT_FOUND", "Room type was not found.");
      assertArrivalWindow(input.checkInDate, hotelCalendarDate(this.clock(), this.config.HOTEL_TIME_ZONE));
      if (!room.active) throw new CommandError(409, "STATE_CONFLICT", "This room type is not accepting new requests.");
      if (input.guestCount > room.capacity) throw new CommandError(400, "VALIDATION_ERROR", "Guest count exceeds room capacity.");
      if (room.currency !== this.config.HOTEL_CURRENCY) throw new CommandError(409, "STATE_CONFLICT", "Room type currency does not match the configured hotel currency.");
      if (input.quoteVersion !== room.version) throw new CommandError(409, "PRICE_CHANGED", "The room price or details changed. Review the current quote.");
      await this.assertInventory(room, input.checkInDate, input.checkOutDate, attempt);
      const price = calculateRoomTotal(nights, 1, room.nightlyPriceMinor);
      const document: ReservationDocument = {
        _id: reservationId, reference, guestId, roomTypeId, roomTypeNameSnapshot: room.name,
        checkInDate: input.checkInDate, checkOutDate: input.checkOutDate, guestCount: input.guestCount,
        roomCount: 1, nightCount: nights, nightlyPriceMinor: room.nightlyPriceMinor, currency: room.currency,
        totalMinor: price.totalMinor, status: "PENDING", version: 0, createdAt: now, updatedAt: now,
      };
      await this.database.collections.reservations.insertOne(document, txnOptions(attempt));
      await appendAuditEvent(this.database, attempt, { actorId: meta.actor.userId, requestId: meta.requestId, entityType: "RESERVATION", entityId: reservationId, action: "CREATE_PENDING", toStatus: "PENDING", createdAt: now });
      await this.writeIdempotency(attempt, meta, operation, requestHash, reservationId, now);
      return toReservationDto(document);
    });
  }

  async confirm(raw: Parameters<ReservationCommands["confirm"]>[0]): Promise<ReservationDto> {
    const input = validateTransitionInput(raw);
    requireStaff(input.actor);
    const reservationId = parseId(input.reservationId);
    const roomTypeId = await this.resolveRoomTypeId(reservationId);
    const now = this.clock();
    const operation = "reservation.confirm";
    const requestHash = hashRequest({ reservationId: reservationId.toHexString(), expectedVersion: input.expectedVersion });
    return this.runIdempotent(input, operation, requestHash, roomTypeId, async (attempt, existing, room) => {
      if (existing) return this.loadReservation(existing.resourceId, attempt.session, attempt.deadline);
      if (!room) throw new CommandError(404, "NOT_FOUND", "Room type was not found.");
      const reservation = await this.loadReservation(reservationId, attempt.session, attempt.deadline);
      this.assertExpectedVersion(reservation, input.expectedVersion);
      const today = hotelCalendarDate(this.clock(), this.config.HOTEL_TIME_ZONE);
      if (!canConfirmReservation(reservation.status, reservation.checkInDate, today, room.active)) {
        throw new CommandError(409, "STATE_CONFLICT", "Reservation cannot be confirmed in its current state.");
      }
      if (reservation.roomTypeId !== roomTypeId.toHexString() || reservation.guestCount > room.capacity) {
        throw new CommandError(409, "STATE_CONFLICT", "Reservation no longer matches the room type capacity.");
      }
      await this.assertInventory(room, reservation.checkInDate, reservation.checkOutDate, attempt, reservationId);
      return this.transition(attempt, input, reservation, "CONFIRMED", "CONFIRM", now, operation, requestHash, { confirmedAt: now });
    });
  }

  async cancel(raw: Parameters<ReservationCommands["cancel"]>[0]): Promise<ReservationDto> {
    const input = validateCancelInput(raw);
    const reservationId = parseId(input.reservationId);
    const roomTypeId = await this.resolveRoomTypeId(reservationId);
    const now = this.clock();
    const operation = "reservation.cancel";
    const requestHash = hashRequest({ reservationId: reservationId.toHexString(), expectedVersion: input.expectedVersion, reason: input.reason ?? null });
    return this.runIdempotent(input, operation, requestHash, roomTypeId, async (attempt, existing, guardedRoom) => {
      if (existing) return this.loadReservation(existing.resourceId, attempt.session, attempt.deadline);
      if (!guardedRoom) throw new CommandError(404, "NOT_FOUND", "Room type was not found.");
      const reservation = await this.loadReservation(reservationId, attempt.session, attempt.deadline);
      const today = hotelCalendarDate(this.clock(), this.config.HOTEL_TIME_ZONE);
      if (input.actor.role === "GUEST" && reservation.guestId !== input.actor.userId) {
        throw new CommandError(404, "NOT_FOUND", "Reservation was not found.");
      }
      assertCancellationActor(input.actor.role, reservation.guestId === input.actor.userId);
      this.assertExpectedVersion(reservation, input.expectedVersion);
      if (!canCancelReservation(reservation.status, reservation.checkInDate, today)) {
        throw new CommandError(409, "STATE_CONFLICT", "Reservation can no longer be cancelled.");
      }
      if (input.actor.role === "STAFF" && !input.reason) throw new CommandError(400, "VALIDATION_ERROR", "Staff cancellation requires a reason.");
      return this.transition(attempt, input, reservation, "CANCELLED", "CANCEL", now, operation, requestHash, {
        cancelledAt: now, cancelledBy: parseId(input.actor.userId), ...(input.reason ? { cancellationReason: input.reason } : {}),
      }, input.reason);
    });
  }

  async checkIn(raw: Parameters<ReservationCommands["checkIn"]>[0]): Promise<ReservationDto> {
    const input = validateTransitionInput(raw); requireStaff(input.actor);
    const reservationId = parseId(input.reservationId); const roomTypeId = await this.resolveRoomTypeId(reservationId);
    const now = this.clock();
    const operation = "reservation.checkIn"; const requestHash = hashRequest({ reservationId: reservationId.toHexString(), expectedVersion: input.expectedVersion });
    return this.runIdempotent(input, operation, requestHash, roomTypeId, async (attempt, existing, guardedRoom) => {
      if (existing) return this.loadReservation(existing.resourceId, attempt.session, attempt.deadline);
      if (!guardedRoom) throw new CommandError(404, "NOT_FOUND", "Room type was not found.");
      const reservation = await this.loadReservation(reservationId, attempt.session, attempt.deadline);
      this.assertExpectedVersion(reservation, input.expectedVersion);
      const today = hotelCalendarDate(this.clock(), this.config.HOTEL_TIME_ZONE);
      if (!canCheckIn(reservation.status, reservation.checkInDate, reservation.checkOutDate, today)) throw new CommandError(409, "STATE_CONFLICT", "Reservation cannot be checked in today.");
      return this.transition(attempt, input, reservation, "CHECKED_IN", "CHECK_IN", now, operation, requestHash, { checkedInAt: now });
    });
  }

  async checkOut(raw: Parameters<ReservationCommands["checkOut"]>[0]): Promise<ReservationDto> {
    const input = validateTransitionInput(raw); requireStaff(input.actor);
    const reservationId = parseId(input.reservationId); const roomTypeId = await this.resolveRoomTypeId(reservationId);
    const now = this.clock();
    const operation = "reservation.checkOut"; const requestHash = hashRequest({ reservationId: reservationId.toHexString(), expectedVersion: input.expectedVersion });
    return this.runIdempotent(input, operation, requestHash, roomTypeId, async (attempt, existing, guardedRoom) => {
      if (existing) return this.loadReservation(existing.resourceId, attempt.session, attempt.deadline);
      if (!guardedRoom) throw new CommandError(404, "NOT_FOUND", "Room type was not found.");
      const reservation = await this.loadReservation(reservationId, attempt.session, attempt.deadline);
      this.assertExpectedVersion(reservation, input.expectedVersion);
      const today = hotelCalendarDate(this.clock(), this.config.HOTEL_TIME_ZONE);
      if (!canCheckOut(reservation.status, reservation.checkOutDate, today)) throw new CommandError(409, "STATE_CONFLICT", "Reservation cannot be checked out yet.");
      return this.transition(attempt, input, reservation, "CHECKED_OUT", "CHECK_OUT", now, operation, requestHash, { checkedOutAt: now });
    });
  }

  private async transition(
    attempt: TransactionAttempt, meta: CommandMeta & { requestId: string }, current: ReservationDto, status: ReservationStatus,
    action: string, now: Date, operation: string, requestHash: string,
    fields: Partial<ReservationDocument>, reason?: string,
  ): Promise<ReservationDto> {
    const reservationId = parseId(current.id);
    const filter: Filter<ReservationDocument> = { _id: reservationId, version: current.version, status: current.status };
    const updated = await this.database.collections.reservations.findOneAndUpdate(filter, {
      $set: { ...fields, status, version: current.version + 1, updatedAt: now },
    }, { ...txnOptions(attempt), returnDocument: "after" });
    if (!updated) throw new CommandError(409, "VERSION_CONFLICT", "Reservation changed; refresh and retry the action.");
    await appendAuditEvent(this.database, attempt, { actorId: meta.actor.userId, requestId: meta.requestId, entityType: "RESERVATION", entityId: reservationId, action, fromStatus: current.status, toStatus: status, ...(reason ? { reason } : {}), createdAt: now });
    await this.writeIdempotency(attempt, meta, operation, requestHash, reservationId, now);
    return toReservationDto(updated);
  }

  private async runIdempotent<T>(
    meta: CommandMeta & { requestId: string }, operation: string, requestHash: string, guardRoomTypeId: ObjectId,
    action: (attempt: TransactionAttempt, existing: IdempotencyDocument | null, guardedRoom: RoomTypeDocument | null) => Promise<T>,
  ): Promise<T> {
    const actorId = parseId(meta.actor.userId);
    const key = meta.operationKey;
    try {
      return await withBoundedTransaction(this.database.client, async (attempt) => {
        // The actual increment is always the first database operation in this transaction.
        const guardedRoom = await this.acquireRoomGuard(guardRoomTypeId, attempt);
        const existing = await this.database.collections.idempotencyRecords.findOne({ actorId, operation, key }, txnOptions(attempt));
        if (existing && existing.requestHash !== requestHash) throw new CommandError(409, "IDEMPOTENCY_CONFLICT", "This operation key was already used for a different request.");
        return action(attempt, existing, guardedRoom);
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw mapTransactionError(error);
      const winner = await this.database.collections.idempotencyRecords.findOne({ actorId, operation, key });
      if (!winner) throw error;
      if (winner.requestHash !== requestHash) throw new CommandError(409, "IDEMPOTENCY_CONFLICT", "This operation key was already used for a different request.");
      return this.loadIdempotentResult<T>(winner);
    }
  }

  private async loadIdempotentResult<T>(record: IdempotencyDocument): Promise<T> {
    const reservation = await this.database.collections.reservations.findOne({ _id: record.resourceId });
    if (reservation) return toReservationDto(reservation) as T;
    const room = await this.database.collections.roomTypes.findOne({ _id: record.resourceId });
    if (room) return toRoomTypeDto(room) as T;
    throw new CommandError(409, "STATE_CONFLICT", "The result of this operation is no longer available.");
  }

  private async acquireRoomGuard(roomTypeId: ObjectId, attempt: TransactionAttempt): Promise<RoomTypeDocument | null> {
    const result = await this.database.collections.roomTypes.updateOne({ _id: roomTypeId }, { $inc: { inventoryVersion: 1 } }, txnOptions(attempt));
    if (result.matchedCount !== 1) return null;
    return this.database.collections.roomTypes.findOne({ _id: roomTypeId }, txnOptions(attempt));
  }

  private async assertInventory(room: RoomTypeDocument, checkInDate: string, checkOutDate: string, attempt: TransactionAttempt, excludeId?: ObjectId): Promise<void> {
    const filter: Filter<ReservationDocument> = {
      roomTypeId: room._id,
      checkInDate: { $lt: checkOutDate }, checkOutDate: { $gt: checkInDate },
      status: { $in: COMMITTED_STATUSES },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    };
    const reservations = await this.database.collections.reservations.find(filter, txnOptions(attempt))
      .project<Pick<ReservationDocument, "checkInDate" | "checkOutDate" | "roomCount" | "status">>({ checkInDate: 1, checkOutDate: 1, roomCount: 1, status: 1 })
      .toArray();
    const peak = calculatePeakOccupancy(checkInDate, checkOutDate, reservations as OccupancyInterval[], room.totalInventory);
    if (peak.available < 1) throw new CommandError(409, "INVENTORY_UNAVAILABLE", "No rooms remain for the complete stay.");
  }

  private async resolveRoomTypeId(reservationId: ObjectId): Promise<ObjectId> {
    const reservation = await this.database.collections.reservations.findOne({ _id: reservationId }, { projection: { roomTypeId: 1 } });
    if (!reservation) throw new CommandError(404, "NOT_FOUND", "Reservation was not found.");
    return reservation.roomTypeId;
  }

  private async loadReservation(id: ObjectId, session: ClientSession, deadline: number): Promise<ReservationDto> {
    const document = await this.database.collections.reservations.findOne({ _id: id }, { session, maxTimeMS: remainingTransactionMs(deadline) });
    if (!document) throw new CommandError(404, "NOT_FOUND", "Reservation was not found.");
    return toReservationDto(document);
  }

  private assertExpectedVersion(reservation: ReservationDto, expectedVersion: number): void {
    if (reservation.version !== expectedVersion) throw new CommandError(409, "VERSION_CONFLICT", "Reservation changed; refresh and retry the action.");
  }

  private async writeIdempotency(attempt: TransactionAttempt, meta: CommandMeta, operation: string, requestHash: string, resourceId: ObjectId, now: Date): Promise<void> {
    const document: IdempotencyDocument = {
      _id: new ObjectId(), actorId: parseId(meta.actor.userId), operation, key: meta.operationKey,
      requestHash, resourceId, createdAt: now,
    };
    await this.database.collections.idempotencyRecords.insertOne(document, txnOptions(attempt));
  }
}

export function createReservationCommandService(database: Database, config: ReservationCommandConfig): ReservationCommandService {
  return new ReservationCommandService(database, config);
}

export function toReservationDto(document: ReservationDocument): ReservationDto {
  return {
    id: document._id.toHexString(), guestId: document.guestId.toHexString(), roomTypeId: document.roomTypeId.toHexString(),
    guestCount: document.guestCount, roomCount: 1, checkInDate: document.checkInDate, checkOutDate: document.checkOutDate,
    status: document.status, priceSnapshot: { amountMinor: document.nightlyPriceMinor, currency: document.currency },
    nights: document.nightCount, total: { amountMinor: document.totalMinor, currency: document.currency }, version: document.version,
    createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString(),
  };
}

export function toRoomTypeDto(document: RoomTypeDocument) {
  return {
    id: document._id.toHexString(), name: document.name, description: document.description, capacity: document.capacity,
    facilities: document.facilities, nightlyPrice: { amountMinor: document.nightlyPriceMinor, currency: document.currency },
    totalInventory: document.totalInventory, active: document.active, version: document.version,
    inventoryVersion: document.inventoryVersion, ...(document.imageUrl === undefined ? {} : { imageUrl: document.imageUrl }),
  };
}

export function hashRequest(input: unknown): string { return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex"); }

function txnOptions(attempt: TransactionAttempt): { session: ClientSession; maxTimeMS: number } {
  return { session: attempt.session, maxTimeMS: remainingTransactionMs(attempt.deadline) };
}
function commandMeta(raw: CommandMeta): CommandMeta & { requestId: string } {
  IdSchema.parse(raw.actor.userId); OperationKeySchema.parse(raw.operationKey);
  return { ...raw, requestId: raw.requestId ?? randomUUID() };
}
function validateTransitionInput<T extends CommandMeta & { reservationId: string; expectedVersion: number }>(raw: T): T & { requestId: string } {
  const meta = commandMeta(raw); IdSchema.parse(raw.reservationId); ExpectedVersionSchema.parse(raw.expectedVersion); return { ...raw, requestId: meta.requestId };
}
function validateCancelInput(raw: Parameters<ReservationCommands["cancel"]>[0]): typeof raw & { requestId: string } {
  const meta = commandMeta(raw); IdSchema.parse(raw.reservationId); ExpectedVersionSchema.parse(raw.expectedVersion);
  const parsed = CancelReservationRequestSchema.parse({ expectedVersion: raw.expectedVersion, ...(raw.reason === undefined ? {} : { reason: raw.reason }) });
  return { ...raw, requestId: meta.requestId, ...(parsed.reason === undefined ? {} : { reason: parsed.reason }) };
}
function parseId(id: string): ObjectId {
  if (!IdSchema.safeParse(id).success) throw new CommandError(400, "VALIDATION_ERROR", "Identifier is invalid.");
  return new ObjectId(id);
}
function requireStaff(actor: Actor): void {
  if (actor.role !== "STAFF") throw new CommandError(403, "FORBIDDEN", "Staff access is required.");
}
function isDuplicateKey(error: unknown): boolean { return error instanceof MongoError && error.code === 11000; }
function mapTransactionError(error: unknown): unknown {
  if (error instanceof TransactionUnavailableError) return new CommandError(503, "SERVICE_UNAVAILABLE", error.message);
  return error;
}
