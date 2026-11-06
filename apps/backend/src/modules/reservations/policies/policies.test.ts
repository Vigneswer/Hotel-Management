import { describe, expect, it } from "vitest";
import { assertArrivalWindow, hotelCalendarDate, validateStay } from "./dates.js";
import { canCancelReservation, canCheckIn, canCheckOut, canConfirmReservation } from "./lifecycle.js";
import { calculateRoomTotal } from "./pricing.js";

describe("reservation domain policies", () => {
  it("validates real calendar dates and counts nights independent of local time", () => {
    expect(validateStay("2028-02-28", "2028-03-01")).toBe(2);
    expect(() => validateStay("2028-02-30", "2028-03-02")).toThrow(/real calendar date/);
  });

  it("uses the configured hotel zone to determine today", () => {
    expect(hotelCalendarDate(new Date("2026-01-01T20:00:00.000Z"), "Asia/Kolkata")).toBe("2026-01-02");
  });

  it("enforces the arrival window and hotel-date lifecycle boundaries", () => {
    expect(() => assertArrivalWindow("2026-11-03", "2026-11-04")).toThrow(/past/);
    expect(canConfirmReservation("PENDING", "2026-11-04", "2026-11-04", true)).toBe(true);
    expect(canCancelReservation("CONFIRMED", "2026-11-05", "2026-11-04")).toBe(true);
    expect(canCancelReservation("CONFIRMED", "2026-11-04", "2026-11-04")).toBe(false);
    expect(canCheckIn("CONFIRMED", "2026-11-04", "2026-11-07", "2026-11-04")).toBe(true);
    expect(canCheckOut("CHECKED_IN", "2026-11-07", "2026-11-07")).toBe(true);
  });

  it("computes safe server-owned minor-unit totals", () => {
    expect(calculateRoomTotal(3, 1, 125_050).totalMinor).toBe(375_150);
    expect(() => calculateRoomTotal(30, 1, Number.MAX_SAFE_INTEGER)).toThrow(/supported amount range/);
  });
});
