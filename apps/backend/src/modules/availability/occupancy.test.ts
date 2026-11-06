import { describe, expect, it } from "vitest";
import { buildOverlapFilter, calculatePeakOccupancy } from "./occupancy.js";

describe("availability occupancy", () => {
  it("does not double count adjacent half-open stays", () => {
    const result = calculatePeakOccupancy("2026-12-10", "2026-12-12", [
      { checkInDate: "2026-12-10", checkOutDate: "2026-12-11", roomCount: 1, status: "CONFIRMED" },
      { checkInDate: "2026-12-11", checkOutDate: "2026-12-12", roomCount: 1, status: "CHECKED_OUT" },
    ], 2);
    expect(result).toEqual({ peak: 1, available: 1 });
  });

  it("reports a single exhausted night as no full-stay availability", () => {
    const result = calculatePeakOccupancy("2026-12-10", "2026-12-13", [
      { checkInDate: "2026-12-11", checkOutDate: "2026-12-12", roomCount: 2, status: "CONFIRMED" },
    ], 2);
    expect(result).toEqual({ peak: 2, available: 0 });
  });

  it("ignores pending overlaps and excludes checkout from occupancy", () => {
    const result = calculatePeakOccupancy("2026-12-10", "2026-12-11", [
      { checkInDate: "2026-12-01", checkOutDate: "2026-12-10", roomCount: 1, status: "CONFIRMED" },
      { checkInDate: "2026-12-10", checkOutDate: "2026-12-11", roomCount: 5, status: "PENDING" },
    ], 1);
    expect(result).toEqual({ peak: 0, available: 1 });
  });

  it("builds a committed-only half-open overlap filter", () => {
    expect(buildOverlapFilter("room-1", "2026-12-10", "2026-12-12")).toEqual({
      roomTypeId: "room-1", checkInDate: { $lt: "2026-12-12" }, checkOutDate: { $gt: "2026-12-10" },
      status: { $in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
    });
  });
});
