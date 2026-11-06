import { DomainPolicyError } from "./dates.js";

export interface PriceTotal { readonly nights: number; readonly roomCount: number; readonly nightlyPriceMinor: number; readonly totalMinor: number }

/** Computes the room subtotal in safe integer minor units; taxes and fees are excluded. */
export function calculateRoomTotal(nights: number, roomCount: number, nightlyPriceMinor: number): PriceTotal {
  if (!Number.isSafeInteger(nights) || nights < 1 || !Number.isSafeInteger(roomCount) || roomCount < 1 ||
      !Number.isSafeInteger(nightlyPriceMinor) || nightlyPriceMinor < 0) {
    throw new DomainPolicyError("Price inputs must be nonnegative safe integer amounts and positive counts.");
  }
  const totalMinor = nights * roomCount * nightlyPriceMinor;
  if (!Number.isSafeInteger(totalMinor)) throw new DomainPolicyError("Price total exceeds the supported amount range.");
  return { nights, roomCount, nightlyPriceMinor, totalMinor };
}
