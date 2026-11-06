import { z } from "zod";
import { PageSchema, QuoteDtoSchema, RoomTypeDtoSchema } from "@hotel/contracts";
import { apiRequest } from "../../lib/api";

const AvailabilityRoomSchema = z.object({ id: z.string(), name: z.string(), description: z.string(), capacity: z.number().int().positive(), facilities: z.array(z.string()), nightlyPriceMinor: z.number().int().nonnegative(), currency: z.string().length(3), totalInventory: z.number().int().nonnegative(), active: z.boolean(), version: z.number().int().nonnegative(), imageUrl: z.string().url().optional(), availableRooms: z.number().int().nonnegative() });
const AvailabilitySchema = z.object({ data: z.array(AvailabilityRoomSchema), pagination: z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean(), advisory: z.literal(true) }), requestId: z.string() });
export type RoomType = z.infer<typeof RoomTypeDtoSchema>;
export type AvailableRoom = z.infer<typeof AvailabilityRoomSchema>;
export type AvailabilityPage = z.infer<typeof AvailabilitySchema>;

/** Requires the catalog HTTP adapter. Keep all filtering and paging on the API. */
export async function listRooms(page = 1, limit = 12) {
  return PageSchema(RoomTypeDtoSchema).parse(await apiRequest<unknown>(`/api/v1/room-types?page=${page}&limit=${limit}`));
}
export async function getRoom(id: string): Promise<RoomType> {
  const response = z.object({ data: RoomTypeDtoSchema, requestId: z.string() }).parse(await apiRequest<unknown>(`/api/v1/room-types/${encodeURIComponent(id)}`));
  return response.data;
}
export async function searchAvailability(input: { checkInDate: string; checkOutDate: string; guestCount: number; limit?: number; cursor?: string | null }): Promise<AvailabilityPage> {
  const query = new URLSearchParams({ checkInDate: input.checkInDate, checkOutDate: input.checkOutDate, guestCount: String(input.guestCount), limit: String(input.limit ?? 12) });
  if (input.cursor) query.set("cursor", input.cursor);
  return AvailabilitySchema.parse(await apiRequest<unknown>(`/api/v1/availability?${query}`));
}
export async function getQuote(input: { roomTypeId: string; checkInDate: string; checkOutDate: string; guestCount: number }) {
  const query = new URLSearchParams({ ...input, guestCount: String(input.guestCount) });
  const response = z.object({ data: QuoteDtoSchema, requestId: z.string() }).parse(await apiRequest<unknown>(`/api/v1/availability/quote?${query}`));
  return response.data;
}
