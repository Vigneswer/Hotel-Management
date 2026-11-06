import { ObjectId, type Filter, type Sort } from "mongodb";
import type { RoomTypeDto } from "@hotel/contracts";
import type { Database, RoomTypeDocument } from "../../infra/database.js";
import type { RoomTypePage, RoomTypePageQuery, RoomTypeReadRepository } from "./read-service.js";

const MAX_OFFSET = 10_000;

export class MongoRoomTypeReadRepository implements RoomTypeReadRepository {
  constructor(private readonly database: Database) {}

  async list(query: RoomTypePageQuery): Promise<RoomTypePage> {
    const filter: Filter<RoomTypeDocument> = {
      ...(query.active === "all" ? {} : { active: query.active }),
      ...(query.minimumCapacity === undefined ? {} : { capacity: { $gte: query.minimumCapacity } }),
      ...(query.facility === undefined ? {} : { facilities: query.facility }),
      ...(query.namePrefix === undefined ? {} : { name: { $regex: `^${escapeRegex(query.namePrefix)}` } }),
    };
    const skip = (query.page - 1) * query.limit;
    if (!Number.isSafeInteger(skip) || skip > MAX_OFFSET) throw new RangeError(`Page offset cannot exceed ${MAX_OFFSET}.`);
    const direction = query.direction === "asc" ? 1 : -1;
    const sort: Sort = query.sort === "price"
      ? { nightlyPriceMinor: direction, _id: direction }
      : { name: direction, _id: direction };
    const [documents, total] = await Promise.all([
      this.database.collections.roomTypes.find(filter).sort(sort).skip(skip).limit(query.limit).toArray(),
      this.database.collections.roomTypes.countDocuments(filter),
    ]);
    return {
      data: documents.map(toRoomTypeDto),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async findById(id: string): Promise<RoomTypeDto | null> {
    if (!ObjectId.isValid(id)) return null;
    const document = await this.database.collections.roomTypes.findOne({ _id: new ObjectId(id) });
    return document ? toRoomTypeDto(document) : null;
  }
}

export function toRoomTypeDto(document: RoomTypeDocument): RoomTypeDto {
  return {
    id: document._id.toHexString(), name: document.name, description: document.description,
    capacity: document.capacity, facilities: document.facilities,
    nightlyPrice: { amountMinor: document.nightlyPriceMinor, currency: document.currency },
    totalInventory: document.totalInventory, active: document.active, version: document.version,
    inventoryVersion: document.inventoryVersion,
    ...(document.imageUrl === undefined ? {} : { imageUrl: document.imageUrl }),
  };
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
