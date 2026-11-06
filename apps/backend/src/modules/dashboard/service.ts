import type { DashboardDto } from "@hotel/contracts";
import { hotelCalendarDate } from "../reservations/policies/dates.js";

export interface DashboardWarnings {
  /** Confirmed stays whose scheduled arrival date has passed. */
  readonly missedArrivals: number;
  /** Checked-in stays whose scheduled checkout date has passed. */
  readonly overdueDepartures: number;
}
export type StaffDashboardMetrics = Omit<DashboardDto, "missedArrivals" | "overdueDepartures"> & DashboardWarnings;
export interface DashboardRepository { readDailyMetrics(today: string): Promise<StaffDashboardMetrics>; }
export interface DashboardConfig { readonly timeZone: string; readonly clock: () => Date; }

export class StaffDashboardService {
  constructor(private readonly repository: DashboardRepository, private readonly config: DashboardConfig) {}

  getSummary(): Promise<StaffDashboardMetrics> {
    const today = hotelCalendarDate(this.config.clock(), this.config.timeZone);
    return this.repository.readDailyMetrics(today);
  }
}
