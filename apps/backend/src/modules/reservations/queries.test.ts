import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Database, ReservationDocument } from "../../infra/database.js";
import { ReservationQueryService } from "./queries.js";

function fixture(): { service: ReservationQueryService; calls: { findFilter?: unknown; countFilter?: unknown; sort?: unknown; skip?: number; limit?: number; guestEmail?: unknown } } {
  const calls: { findFilter?: unknown; countFilter?: unknown; sort?: unknown; skip?: number; limit?: number; guestEmail?: unknown } = {};
  const guestId = new ObjectId(); const roomTypeId = new ObjectId(); const reservationId = new ObjectId();
  const document: ReservationDocument = {
    _id: reservationId, reference: "HTL-ABC123", guestId, roomTypeId, roomTypeNameSnapshot: "Deluxe", checkInDate: "2026-12-10", checkOutDate: "2026-12-12",
    guestCount: 2, roomCount: 1, nightCount: 2, nightlyPriceMinor: 120_000, currency: "INR", totalMinor: 240_000,
    status: "CONFIRMED", version: 1, createdAt: new Date("2026-10-01T00:00:00.000Z"), updatedAt: new Date("2026-10-02T00:00:00.000Z"),
  };
  const cursor = {
    sort(sort: unknown) { calls.sort = sort; return this; },
    skip(value: number) { calls.skip = value; return this; },
    limit(value: number) { calls.limit = value; return this; },
    async toArray() { return [document]; },
  };
  const fake = {
    collections: {
      reservations: {
        find(filter: unknown) { calls.findFilter = filter; return cursor; },
        async countDocuments(filter: unknown) { calls.countFilter = filter; return 41; },
        async findOne(filter: unknown) { calls.findFilter = filter; return document; },
      },
      users: { async findOne(filter: unknown) { calls.guestEmail = filter; return { _id: guestId }; } },
      auditEvents: { find() { return cursor; }, async countDocuments() { return 0; } },
    },
  } as unknown as Database;
  return { service: new ReservationQueryService(fake), calls };
}

describe("reservation query pagination and access filters", () => {
  it("filters a guest page by owner before sorting and applying bounded database pagination", async () => {
    const { service, calls } = fixture();
    const page = await service.listMine("000000000000000000000001", { page: 3, limit: 10, status: "CONFIRMED" });
    expect(calls.findFilter).toMatchObject({ guestId: new ObjectId("000000000000000000000001"), status: "CONFIRMED" });
    expect(calls.countFilter).toEqual(calls.findFilter);
    expect(calls.sort).toEqual({ createdAt: -1, _id: -1 });
    expect(calls.skip).toBe(20);
    expect(calls.limit).toBe(10);
    expect(page.pagination).toEqual({ page: 3, limit: 10, total: 41, totalPages: 5 });
  });

  it("applies staff filters before pagination and resolves guest email to an exact owner ID", async () => {
    const { service, calls } = fixture();
    await service.listStaff({
      page: 2, limit: 5, status: "PENDING", reference: "htl-abc123", guestEmail: "Guest@Example.com",
      checkInFrom: "2026-12-01", checkInTo: "2026-12-31",
    });
    expect(calls.guestEmail).toEqual({ emailNormalized: "guest@example.com" });
    expect(calls.findFilter).toMatchObject({
      status: "PENDING", reference: "HTL-ABC123", guestId: expect.any(ObjectId),
      checkInDate: { $gte: "2026-12-01", $lte: "2026-12-31" },
    });
    expect(calls.countFilter).toEqual(calls.findFilter);
    expect(calls.skip).toBe(5);
  });

  it("scopes guest detail lookup by both reservation ID and owner", async () => {
    const { service, calls } = fixture();
    const id = new ObjectId().toHexString();
    const result = await service.getById(id, { userId: new ObjectId().toHexString(), role: "GUEST" });
    expect(result?.status).toBe("CONFIRMED");
    expect(calls.findFilter).toMatchObject({ _id: new ObjectId(id), guestId: expect.any(ObjectId) });
  });
});
