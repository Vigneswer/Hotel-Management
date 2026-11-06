import { PageSchema, RoomTypeDtoSchema, RoomTypeWriteSchema, RoomTypeUpdateSchema, type RoomTypeDto } from "@hotel/contracts";
import { z } from "zod";
import { apiRequest, completeOperation, operationKey } from "../../lib/api";
import type { z as Z } from "zod";

const Result = z.object({ data: RoomTypeDtoSchema, requestId: z.string() });
export type RoomWrite = Z.infer<typeof RoomTypeWriteSchema>;
export async function listStaffRooms(page: number, limit: number, active?: boolean) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) }); if (active !== undefined) query.set("active", active ? "active" : "inactive");
  return PageSchema(RoomTypeDtoSchema).parse(await apiRequest<unknown>(`/api/v1/staff/room-types?${query}`));
}
export async function saveRoom(room: RoomWrite, current?: RoomTypeDto) {
  const scope = current ? `staff-room-${current.id}-v${current.version}` : `staff-room-create-${JSON.stringify(room)}`;
  const body = current ? RoomTypeUpdateSchema.parse({ ...room, expectedVersion: current.version }) : RoomTypeWriteSchema.parse(room);
  const response = await apiRequest<unknown>(current ? `/api/v1/staff/room-types/${encodeURIComponent(current.id)}` : "/api/v1/staff/room-types", { method: current ? "PATCH" : "POST", body, idempotencyKey: operationKey(localStorage, scope) });
  const data = Result.parse(response).data; completeOperation(localStorage, scope); return data;
}
export async function deactivateRoom(room: RoomTypeDto) {
  const scope = `staff-room-deactivate-${room.id}-v${room.version}`;
  const response = await apiRequest<unknown>(`/api/v1/staff/room-types/${encodeURIComponent(room.id)}/deactivate`, { method: "POST", body: { expectedVersion: room.version }, idempotencyKey: operationKey(localStorage, scope) });
  const data = Result.parse(response).data; completeOperation(localStorage, scope); return data;
}
export async function activateRoom(room: RoomTypeDto) {
  const scope = `staff-room-activate-${room.id}-v${room.version}`;
  const response = await apiRequest<unknown>(`/api/v1/staff/room-types/${encodeURIComponent(room.id)}/activate`, { method: "POST", body: { expectedVersion: room.version }, idempotencyKey: operationKey(localStorage, scope) });
  const data = Result.parse(response).data; completeOperation(localStorage, scope); return data;
}
