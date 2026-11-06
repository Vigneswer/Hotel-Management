import type { ReservationStatus } from "@hotel/contracts";
import { parseCalendarDate } from "../reservations/policies/dates.js";

export interface OccupancyInterval { readonly checkInDate: string; readonly checkOutDate: string; readonly roomCount: number; readonly status?: ReservationStatus }
export interface PeakOccupancy { readonly peak: number; readonly available: number }

export const COMMITTED_STATUSES: readonly ReservationStatus[] = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

export function isCommittedStatus(status: ReservationStatus): boolean {
  return COMMITTED_STATUSES.includes(status);
}

/** Peak overlapping rooms over half-open intervals [check-in, check-out). */
export function calculatePeakOccupancy(
  requestedCheckIn: string,
  requestedCheckOut: string,
  intervals: readonly OccupancyInterval[],
  totalInventory: number,
): PeakOccupancy {
  const requestedStart = parseCalendarDate(requestedCheckIn);
  const requestedEnd = parseCalendarDate(requestedCheckOut);
  if (requestedEnd <= requestedStart) throw new Error("Requested interval must be nonempty.");
  if (!Number.isSafeInteger(totalInventory) || totalInventory < 0) throw new Error("Inventory must be a nonnegative integer.");
  const boundaries = new Map<number, number>();
  for (const interval of intervals) {
    if (interval.status !== undefined && !isCommittedStatus(interval.status)) continue;
    const start = Math.max(requestedStart, parseCalendarDate(interval.checkInDate));
    const end = Math.min(requestedEnd, parseCalendarDate(interval.checkOutDate));
    if (end <= start) continue;
    if (!Number.isSafeInteger(interval.roomCount) || interval.roomCount < 1) throw new Error("Room count must be a positive integer.");
    boundaries.set(start, (boundaries.get(start) ?? 0) + interval.roomCount);
    boundaries.set(end, (boundaries.get(end) ?? 0) - interval.roomCount);
  }
  let occupied = 0;
  let peak = 0;
  for (const date of [...boundaries.keys()].sort((a, b) => a - b)) {
    occupied += boundaries.get(date) ?? 0;
    peak = Math.max(peak, occupied);
  }
  return { peak, available: Math.max(0, totalInventory - peak) };
}

export interface OverlapFilter { readonly roomTypeId: string; readonly checkInDate: { readonly $lt: string }; readonly checkOutDate: { readonly $gt: string }; readonly status: { readonly $in: readonly ReservationStatus[] } }
export type OverlapRangeFilter = Pick<OverlapFilter, "checkInDate" | "checkOutDate" | "status">;
export function buildOverlapRange(checkInDate: string, checkOutDate: string): OverlapRangeFilter {
  parseCalendarDate(checkInDate);
  parseCalendarDate(checkOutDate);
  if (checkOutDate <= checkInDate) throw new Error("Requested interval must be nonempty.");
  return { checkInDate: { $lt: checkOutDate }, checkOutDate: { $gt: checkInDate }, status: { $in: COMMITTED_STATUSES } };
}

export function buildOverlapFilter(roomTypeId: string, checkInDate: string, checkOutDate: string): OverlapFilter {
  return { roomTypeId, ...buildOverlapRange(checkInDate, checkOutDate) };
}
