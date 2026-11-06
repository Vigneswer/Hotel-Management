import { describe, expect, it } from "vitest";
import { AvailabilityService, type AvailabilityRepository, type AvailabilityRoomType } from "./service.js";

const room = (id: string, name: string, inventory = 1): AvailabilityRoomType => ({
  id, name, description: "Room", capacity: 2, facilities: [], nightlyPriceMinor: 12_500, currency: "INR",
  totalInventory: inventory, active: true, version: 7,
});
const id1 = "000000000000000000000001";
const id2 = "000000000000000000000002";

function repository(rooms: readonly AvailabilityRoomType[], exhaustedIds: readonly string[] = []): AvailabilityRepository {
  return {
    async findRoomType(id) { return rooms.find((item) => item.id === id) ?? null; },
    async listActiveRoomTypes({ minimumCapacity, after, limit }) {
      let ordered = rooms.filter((item) => item.active && item.capacity >= minimumCapacity).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      if (after) {
        const decoded: unknown = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
        if (Array.isArray(decoded) && typeof decoded[0] === "string" && typeof decoded[1] === "string") {
          ordered = ordered.filter((item) => item.name > decoded[0] || (item.name === decoded[0] && item.id > decoded[1]));
        }
      }
      return { items: ordered.slice(0, limit), hasMore: ordered.length > limit };
    },
    async findOverlappingReservations({ roomTypeIds, checkInDate, checkOutDate }) {
      return roomTypeIds.filter((id) => exhaustedIds.includes(id)).map((roomTypeId) => ({
        roomTypeId, checkInDate, checkOutDate, roomCount: 1, status: "CONFIRMED" as const,
      }));
    },
  };
}

describe("availability service", () => {
  const config = { timeZone: "Asia/Kolkata", clock: () => new Date("2026-11-04T06:00:00.000Z"), maxScan: 100 };

  it("quotes dates and totals from the current server room price", async () => {
    const service = new AvailabilityService(repository([room(id1, "A")]), config);
    await expect(service.quote({ roomTypeId: id1, checkInDate: "2026-11-04", checkOutDate: "2026-11-06", guestCount: 2 })).resolves.toMatchObject({
      nights: 2, nightlyPrice: { amountMinor: 12_500, currency: "INR" }, total: { amountMinor: 25_000, currency: "INR" }, quoteVersion: 7,
    });
  });

  it("filters capacity and full-stay inventory before returning an advisory page", async () => {
    const types = [room(id1, "A", 1), room(id2, "B", 1), { ...room("000000000000000000000003", "C"), capacity: 1 }];
    const service = new AvailabilityService(repository(types, [id1]), config);
    const result = await service.search({ checkInDate: "2026-11-04", checkOutDate: "2026-11-06", guestCount: 2, limit: 1, cursor: null });
    expect(result.data.map((item) => item.id)).toEqual([id2]);
    expect(result.pagination).toMatchObject({ limit: 1, advisory: true, hasMore: false, nextCursor: null });
  });

  it("returns a keyset continuation after the last scanned candidate", async () => {
    const service = new AvailabilityService(repository([room(id1, "A"), room(id2, "B")]), config);
    const first = await service.search({ checkInDate: "2026-11-04", checkOutDate: "2026-11-05", guestCount: 1, limit: 1, cursor: null });
    expect(first.pagination.hasMore).toBe(true);
    expect(first.pagination.nextCursor).toBeTruthy();
    const second = await service.search({ checkInDate: "2026-11-04", checkOutDate: "2026-11-05", guestCount: 1, limit: 1, cursor: first.pagination.nextCursor });
    expect(second.data.map((item) => item.id)).toEqual([id2]);
    expect(second.pagination.hasMore).toBe(false);
  });
});
