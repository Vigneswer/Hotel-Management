import { describe, expect, it } from "vitest";
import type { DashboardRepository, StaffDashboardMetrics } from "./service.js";
import { StaffDashboardService } from "./service.js";

describe("StaffDashboardService", () => {
  it("uses the hotel calendar date and returns overdue and missed-arrival warnings", async () => {
    let receivedDate: string | undefined;
    const metrics: StaffDashboardMetrics = {
      arrivals: 2, departures: 1, occupiedRooms: 3, pendingReservations: 4,
      missedArrivals: 2, overdueDepartures: 1,
    };
    const repository: DashboardRepository = { readDailyMetrics: async (today) => { receivedDate = today; return metrics; } };
    const service = new StaffDashboardService(repository, { timeZone: "Asia/Kolkata", clock: () => new Date("2026-11-03T19:00:00.000Z") });
    expect(await service.getSummary()).toEqual(metrics);
    expect(receivedDate).toBe("2026-11-04");
  });
});
