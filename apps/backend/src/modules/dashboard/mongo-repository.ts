import type { Database } from "../../infra/database.js";
import type { DashboardRepository, StaffDashboardMetrics } from "./service.js";

interface CountBucket { readonly count: number; }
interface SumBucket { readonly total: number; }
interface DashboardAggregate {
  readonly arrivals?: readonly CountBucket[];
  readonly departures?: readonly CountBucket[];
  readonly occupiedRooms?: readonly SumBucket[];
  readonly pendingReservations?: readonly CountBucket[];
  readonly missedArrivals?: readonly CountBucket[];
  readonly overdueDepartures?: readonly CountBucket[];
}

export class MongoDashboardRepository implements DashboardRepository {
  constructor(private readonly database: Database) {}

  async readDailyMetrics(today: string): Promise<StaffDashboardMetrics> {
    const [result] = await this.database.collections.reservations.aggregate<DashboardAggregate>([
      { $match: { status: { $in: ["CONFIRMED", "CHECKED_IN", "PENDING"] } } },
      { $facet: {
        arrivals: [{ $match: { status: "CONFIRMED", checkInDate: today } }, { $count: "count" }],
        departures: [{ $match: { status: "CHECKED_IN", checkOutDate: today } }, { $count: "count" }],
        occupiedRooms: [{ $match: { status: "CHECKED_IN" } }, { $group: { _id: null, total: { $sum: "$roomCount" } } }],
        pendingReservations: [{ $match: { status: "PENDING" } }, { $count: "count" }],
        missedArrivals: [{ $match: { status: "CONFIRMED", checkInDate: { $lt: today } } }, { $count: "count" }],
        overdueDepartures: [{ $match: { status: "CHECKED_IN", checkOutDate: { $lt: today } } }, { $count: "count" }],
      } },
    ]).toArray();
    return {
      arrivals: firstCount(result?.arrivals), departures: firstCount(result?.departures),
      occupiedRooms: result?.occupiedRooms?.[0]?.total ?? 0, pendingReservations: firstCount(result?.pendingReservations),
      missedArrivals: firstCount(result?.missedArrivals), overdueDepartures: firstCount(result?.overdueDepartures),
    };
  }
}

function firstCount(buckets: readonly CountBucket[] | undefined): number { return buckets?.[0]?.count ?? 0; }
