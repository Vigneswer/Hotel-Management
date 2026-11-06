import { AuditEventDtoSchema, PageSchema, ReservationDtoSchema, type ReservationDto, type ReservationStatus } from "@hotel/contracts";
import { z } from "zod";
import { apiRequest, completeOperation, operationKey } from "../../lib/api";

const One = z.object({ data: ReservationDtoSchema, requestId: z.string() });
export type StaffFilters = { page: number; limit: number; status?: ReservationStatus; reference?: string; roomTypeId?: string; guestEmail?: string; checkInDate?: string; checkOutDate?: string; checkInFrom?: string; checkInTo?: string; checkOutFrom?: string; checkOutTo?: string };
export async function listStaffReservations(filters: StaffFilters) {
  const query = new URLSearchParams({ page: String(filters.page), limit: String(filters.limit) });
  for (const key of ["status", "reference", "roomTypeId", "guestEmail", "checkInFrom", "checkInTo", "checkOutFrom", "checkOutTo"] as const) if (filters[key]) query.set(key, String(filters[key]));
  if (filters.checkInDate) { query.set("checkInFrom", filters.checkInDate); query.set("checkInTo", filters.checkInDate); }
  if (filters.checkOutDate) { query.set("checkOutFrom", filters.checkOutDate); query.set("checkOutTo", filters.checkOutDate); }
  return PageSchema(ReservationDtoSchema).parse(await apiRequest<unknown>(`/api/v1/staff/reservations?${query}`));
}
export async function getStaffReservation(id: string) { return One.parse(await apiRequest<unknown>(`/api/v1/staff/reservations/${encodeURIComponent(id)}`)).data; }
export async function listReservationAudit(id: string) { return PageSchema(AuditEventDtoSchema).parse(await apiRequest<unknown>(`/api/v1/staff/reservations/${encodeURIComponent(id)}/audit?page=1&limit=50`)); }
export type ReservationAction = "confirm" | "cancel" | "check-in" | "check-out";
export async function mutateReservation(reservation: ReservationDto, action: ReservationAction, reason?: string) {
  const scope = `staff-${action}-${reservation.id}-v${reservation.version}`;
  const body = action === "cancel" ? { expectedVersion: reservation.version, reason } : { expectedVersion: reservation.version };
  try {
    const result = One.parse(await apiRequest<unknown>(`/api/v1/staff/reservations/${encodeURIComponent(reservation.id)}/${action}`, { method: "POST", body, idempotencyKey: operationKey(localStorage, scope) }));
    completeOperation(localStorage, scope); return result.data;
  } catch (error) { throw error; }
}
