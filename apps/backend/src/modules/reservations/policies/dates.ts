import { DateOnlySchema } from "@hotel/contracts";

export const MIN_STAY_NIGHTS = 1;
export const MAX_STAY_NIGHTS = 30;
export const MAX_ARRIVAL_DAYS_AHEAD = 365;

export class DomainPolicyError extends Error {
  constructor(message: string, readonly code = "VALIDATION_ERROR") {
    super(message);
    this.name = "DomainPolicyError";
  }
}

/** Calendar validation is stricter than the shared shape-only request schema. */
export function parseCalendarDate(value: string): number {
  if (!DateOnlySchema.safeParse(value).success) throw new DomainPolicyError("Date must use YYYY-MM-DD format.");
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new DomainPolicyError("Date is not a real calendar date.");
  }
  return parsed.getTime();
}

export function validateStay(checkInDate: string, checkOutDate: string): number {
  const start = parseCalendarDate(checkInDate);
  const end = parseCalendarDate(checkOutDate);
  const nights = (end - start) / 86_400_000;
  if (!Number.isInteger(nights) || nights < MIN_STAY_NIGHTS || nights > MAX_STAY_NIGHTS) {
    throw new DomainPolicyError(`Stay must be between ${MIN_STAY_NIGHTS} and ${MAX_STAY_NIGHTS} nights.`);
  }
  return nights;
}

export function hotelCalendarDate(now: Date, timeZone: string): string {
  if (!Number.isFinite(now.getTime())) throw new DomainPolicyError("Clock returned an invalid instant.");
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  } catch {
    throw new DomainPolicyError("Hotel time zone is invalid.");
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new DomainPolicyError("Could not determine hotel calendar date.");
  return `${year}-${month}-${day}`;
}

export function assertArrivalWindow(checkInDate: string, today: string): void {
  const arrival = parseCalendarDate(checkInDate);
  const current = parseCalendarDate(today);
  if (arrival < current) throw new DomainPolicyError("Check-in date cannot be in the past.");
  if ((arrival - current) / 86_400_000 > MAX_ARRIVAL_DAYS_AHEAD) {
    throw new DomainPolicyError(`Check-in date cannot be more than ${MAX_ARRIVAL_DAYS_AHEAD} days ahead.`);
  }
}

