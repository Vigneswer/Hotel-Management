import { describe, expect, it } from "vitest";
import type { Database } from "../../infra/database.js";
import { MongoDashboardRepository } from "./mongo-repository.js";

describe("MongoDashboardRepository", () => {
  it("derives daily counts and overdue warnings from the required lifecycle states", async () => {
    let pipeline: unknown[] = [];
    const aggregateResult = [{
      arrivals: [{ count: 2 }], departures: [{ count: 1 }], occupiedRooms: [{ total: 3 }],
      pendingReservations: [{ count: 4 }], missedArrivals: [{ count: 5 }], overdueDepartures: [{ count: 1 }],
    }];
    const database = { collections: { reservations: { aggregate: (value: unknown[]) => { pipeline = value; return { toArray: async () => aggregateResult }; } } } } as unknown as Database;
    const result = await new MongoDashboardRepository(database).readDailyMetrics("2026-11-04");
    expect(result).toEqual({ arrivals: 2, departures: 1, occupiedRooms: 3, pendingReservations: 4, missedArrivals: 5, overdueDepartures: 1 });
    const match = pipeline[0] as { $match: { status: { $in: string[] } } };
    expect(match.$match.status.$in).toEqual(["CONFIRMED", "CHECKED_IN", "PENDING"]);
  });
});
