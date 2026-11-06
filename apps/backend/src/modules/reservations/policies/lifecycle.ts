import type { ReservationStatus, Role } from "@hotel/contracts";
import { DomainPolicyError, parseCalendarDate } from "./dates.js";

export function canConfirmReservation(status: ReservationStatus, checkInDate: string, today: string, roomTypeActive: boolean): boolean {
  parseCalendarDate(checkInDate);
  parseCalendarDate(today);
  return status === "PENDING" && checkInDate >= today && roomTypeActive;
}

export function canCancelReservation(status: ReservationStatus, checkInDate: string, today: string): boolean {
  parseCalendarDate(checkInDate);
  parseCalendarDate(today);
  return (status === "PENDING" || status === "CONFIRMED") && today < checkInDate;
}

export function assertCancellationActor(role: Role, isOwner: boolean): void {
  if (role === "STAFF" || (role === "GUEST" && isOwner)) return;
  throw new DomainPolicyError("Guest can cancel only their own reservation.", "FORBIDDEN");
}

export function canCheckIn(status: ReservationStatus, checkInDate: string, checkOutDate: string, today: string): boolean {
  parseCalendarDate(checkInDate);
  parseCalendarDate(checkOutDate);
  parseCalendarDate(today);
  return status === "CONFIRMED" && today >= checkInDate && today < checkOutDate;
}

export function canCheckOut(status: ReservationStatus, checkOutDate: string, today: string): boolean {
  parseCalendarDate(checkOutDate);
  parseCalendarDate(today);
  return status === "CHECKED_IN" && today >= checkOutDate;
}
