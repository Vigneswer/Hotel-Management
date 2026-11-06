export interface BookingSelection { roomTypeId: string; checkInDate: string; checkOutDate: string; guestCount: number }
const KEY = "hotel.guest.booking-selection";
export function saveBookingSelection(selection: BookingSelection): void { sessionStorage.setItem(KEY, JSON.stringify(selection)); }
export function readBookingSelection(): BookingSelection | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (typeof value !== "object" || value === null || !("roomTypeId" in value) || !("checkInDate" in value) || !("checkOutDate" in value) || !("guestCount" in value)) return null;
    if (typeof value.roomTypeId !== "string" || typeof value.checkInDate !== "string" || typeof value.checkOutDate !== "string" || typeof value.guestCount !== "number") return null;
    return { roomTypeId: value.roomTypeId, checkInDate: value.checkInDate, checkOutDate: value.checkOutDate, guestCount: value.guestCount };
  } catch { return null; }
}
