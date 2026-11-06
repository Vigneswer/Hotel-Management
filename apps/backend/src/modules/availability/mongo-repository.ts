import { ObjectId, type Filter } from "mongodb";
import type { Database, ReservationDocument, RoomTypeDocument } from "../../infra/database.js";
import { availabilityCursorPosition, type AvailabilityCandidate, type AvailabilityRepository, type AvailabilityRoomType } from "./service.js";
import { buildOverlapRange } from "./occupancy.js";

function asRoomType(document: RoomTypeDocument): AvailabilityRoomType {
  return {
    id: document._id.toHexString(), name: document.name, description: document.description,
    capacity: document.capacity, facilities: document.facilities, nightlyPriceMinor: document.nightlyPriceMinor,
    currency: document.currency, totalInventory: document.totalInventory, active: document.active,
    version: document.version,
    ...(document.imageUrl === undefined ? {} : { imageUrl: document.imageUrl }),
  };
}

export class MongoAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly database: Database) {}

  async findRoomType(id: string): Promise<AvailabilityRoomType | null> {
    if (!ObjectId.isValid(id)) return null;
    const document = await this.database.collections.roomTypes.findOne({ _id: new ObjectId(id) });
    return document ? asRoomType(document) : null;
  }

  async listActiveRoomTypes(input: { minimumCapacity: number; after: string | null; limit: number }): Promise<{ items: readonly AvailabilityRoomType[]; hasMore: boolean }> {
    const position = availabilityCursorPosition(input.after);
    const filter: Filter<RoomTypeDocument> = {
      active: true,
      capacity: { $gte: input.minimumCapacity },
      ...(position === null ? {} : {
        $or: [
          { name: { $gt: position.name } },
          { name: position.name, _id: { $gt: new ObjectId(position.id) } },
        ],
      }),
    };
    const found = await this.database.collections.roomTypes.find(filter)
      .sort({ name: 1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();
    const hasMore = found.length > input.limit;
    return { items: found.slice(0, input.limit).map(asRoomType), hasMore };
  }

  async findOverlappingReservations(input: { roomTypeIds: readonly string[]; checkInDate: string; checkOutDate: string }): Promise<readonly AvailabilityCandidate[]> {
    if (input.roomTypeIds.length === 0) return [];
    const roomTypeIds = input.roomTypeIds.filter(ObjectId.isValid).map((id) => new ObjectId(id));
    if (roomTypeIds.length === 0) return [];
    // This is one batched overlap read for the candidate page, not one lookup per room type.
    const overlap = buildOverlapRange(input.checkInDate, input.checkOutDate);
    const filter: Filter<ReservationDocument> = {
      roomTypeId: { $in: roomTypeIds },
      checkInDate: overlap.checkInDate,
      checkOutDate: overlap.checkOutDate,
      status: overlap.status,
    };
    const documents = await this.database.collections.reservations.find(filter)
      .project<Pick<ReservationDocument, "roomTypeId" | "checkInDate" | "checkOutDate" | "roomCount" | "status">>({
        roomTypeId: 1, checkInDate: 1, checkOutDate: 1, roomCount: 1, status: 1,
      })
      .toArray();
    return documents.map((document: Pick<ReservationDocument, "roomTypeId" | "checkInDate" | "checkOutDate" | "roomCount" | "status">) => ({
      roomTypeId: document.roomTypeId.toHexString(), checkInDate: document.checkInDate,
      checkOutDate: document.checkOutDate, roomCount: document.roomCount, status: document.status,
    }));
  }
}
