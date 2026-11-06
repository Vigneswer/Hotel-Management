import type { QuoteDto } from "@hotel/contracts";
import { calculateRoomTotal } from "../reservations/policies/pricing.js";
import { assertArrivalWindow, DomainPolicyError, hotelCalendarDate, validateStay } from "../reservations/policies/dates.js";
import { calculatePeakOccupancy, type OccupancyInterval } from "./occupancy.js";

export interface AvailabilityRoomType {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capacity: number;
  readonly facilities: readonly string[];
  readonly nightlyPriceMinor: number;
  readonly currency: string;
  readonly totalInventory: number;
  readonly active: boolean;
  readonly version: number;
  readonly imageUrl?: string;
}

export interface AvailabilityCandidate extends OccupancyInterval { readonly roomTypeId: string }
export interface AvailabilityRepository {
  findRoomType(id: string): Promise<AvailabilityRoomType | null>;
  listActiveRoomTypes(input: { readonly minimumCapacity: number; readonly after: string | null; readonly limit: number }): Promise<{ readonly items: readonly AvailabilityRoomType[]; readonly hasMore: boolean }>;
  findOverlappingReservations(input: {
    readonly roomTypeIds: readonly string[];
    readonly checkInDate: string;
    readonly checkOutDate: string;
  }): Promise<readonly AvailabilityCandidate[]>;
}

export interface AvailabilityConfig { readonly timeZone: string; readonly clock: () => Date; readonly maxScan: number }
export interface AvailabilityResult {
  readonly data: readonly (AvailabilityRoomType & { readonly availableRooms: number })[];
  readonly pagination: { readonly limit: number; readonly nextCursor: string | null; readonly hasMore: boolean; readonly advisory: true };
}

export class AvailabilityNotFoundError extends Error {
  constructor() { super("Room type is unavailable."); this.name = "AvailabilityNotFoundError"; }
}

export function cursorFor(room: Pick<AvailabilityRoomType, "name" | "id">): string {
  return Buffer.from(JSON.stringify([room.name, room.id]), "utf8").toString("base64url");
}

/** Decode only the module's cursor form. It is a keyset position, not an authorization token. */
export function decodeAvailabilityCursor(cursor: string | null): string | null {
  if (cursor === null) return null;
  if (cursor.length > 512) throw new DomainPolicyError("Invalid availability cursor.");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string" || !parsed[0] || !/^[a-f\d]{24}$/i.test(parsed[1])) throw new Error();
    return cursor;
  } catch {
    throw new DomainPolicyError("Invalid availability cursor.");
  }
}

export function availabilityCursorPosition(cursor: string | null): { readonly name: string; readonly id: string } | null {
  const validated = decodeAvailabilityCursor(cursor);
  if (validated === null) return null;
  const parsed: unknown = JSON.parse(Buffer.from(validated, "base64url").toString("utf8"));
  if (!Array.isArray(parsed)) throw new DomainPolicyError("Invalid availability cursor.");
  const name = parsed[0];
  const id = parsed[1];
  if (typeof name !== "string" || typeof id !== "string") throw new DomainPolicyError("Invalid availability cursor.");
  return { name, id };
}

export class AvailabilityService {
  constructor(private readonly repository: AvailabilityRepository, private readonly config: AvailabilityConfig) {
    if (!Number.isSafeInteger(config.maxScan) || config.maxScan < 1) throw new Error("Availability scan bound must be a positive integer.");
  }

  private today(): string { return hotelCalendarDate(this.config.clock(), this.config.timeZone); }

  async quote(input: { roomTypeId: string; checkInDate: string; checkOutDate: string; guestCount: number }): Promise<QuoteDto> {
    const nights = validateStay(input.checkInDate, input.checkOutDate);
    assertArrivalWindow(input.checkInDate, this.today());
    if (!Number.isSafeInteger(input.guestCount) || input.guestCount < 1) throw new DomainPolicyError("Guest count must be a positive integer.");
    const room = await this.repository.findRoomType(input.roomTypeId);
    if (!room || !room.active) throw new AvailabilityNotFoundError();
    if (input.guestCount > room.capacity) throw new DomainPolicyError("Guest count exceeds room capacity.");
    const total = calculateRoomTotal(nights, 1, room.nightlyPriceMinor);
    const result: QuoteDto = {
      roomTypeId: room.id, checkInDate: input.checkInDate, checkOutDate: input.checkOutDate,
      guestCount: input.guestCount, nights,
      nightlyPrice: { amountMinor: room.nightlyPriceMinor, currency: room.currency },
      total: { amountMinor: total.totalMinor, currency: room.currency }, quoteVersion: room.version,
    };
    return result;
  }

  async search(input: { checkInDate: string; checkOutDate: string; guestCount: number; limit: number; cursor: string | null }): Promise<AvailabilityResult> {
    validateStay(input.checkInDate, input.checkOutDate);
    assertArrivalWindow(input.checkInDate, this.today());
    if (!Number.isSafeInteger(input.guestCount) || input.guestCount < 1) throw new DomainPolicyError("Guest count must be a positive integer.");
    const after = decodeAvailabilityCursor(input.cursor);
    const results: Array<AvailabilityRoomType & { availableRooms: number }> = [];
    let scanned = 0;
    let lastScanned: AvailabilityRoomType | undefined;
    let hasMoreCandidates = false;
    let position = after;
    const batchSize = Math.min(100, Math.max(input.limit, 20));

    while (scanned < this.config.maxScan && results.length < input.limit) {
      const batch = await this.repository.listActiveRoomTypes({ minimumCapacity: input.guestCount, after: position, limit: Math.min(batchSize, this.config.maxScan - scanned) });
      if (batch.items.length === 0) { hasMoreCandidates = false; break; }
      const occupancy = await this.repository.findOverlappingReservations({
        roomTypeIds: batch.items.map((room) => room.id), checkInDate: input.checkInDate, checkOutDate: input.checkOutDate,
      });
      const byRoom = new Map<string, AvailabilityCandidate[]>();
      for (const reservation of occupancy) {
        const list = byRoom.get(reservation.roomTypeId) ?? [];
        list.push(reservation);
        byRoom.set(reservation.roomTypeId, list);
      }
      let consumed = 0;
      for (const room of batch.items) {
        const peak = calculatePeakOccupancy(input.checkInDate, input.checkOutDate, byRoom.get(room.id) ?? [], room.totalInventory);
        consumed += 1;
        scanned += 1;
        lastScanned = room;
        if (peak.available > 0) results.push({ ...room, availableRooms: peak.available });
        if (results.length >= input.limit || scanned >= this.config.maxScan) break;
      }
      position = lastScanned ? cursorFor(lastScanned) : position;
      const remainingInBatch = consumed < batch.items.length;
      hasMoreCandidates = remainingInBatch || batch.hasMore;
      if (results.length >= input.limit || scanned >= this.config.maxScan) break;
      if (!batch.hasMore) { hasMoreCandidates = false; break; }
    }

    const hasMore = hasMoreCandidates && lastScanned !== undefined;
    return {
      data: results,
      pagination: { limit: input.limit, nextCursor: hasMore && lastScanned ? cursorFor(lastScanned) : null, hasMore, advisory: true },
    };
  }
}

