import { ObjectId, type Collection, type Filter } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Database, RoomTypeDocument } from "../../infra/database.js";
import { MongoRoomTypeReadRepository } from "./mongo-repository.js";

describe("MongoRoomTypeReadRepository", () => {
  it("applies allowlisted filters before server-side pagination and preserves a stable sort", async () => {
    const id = new ObjectId();
    const document: RoomTypeDocument = {
      _id: id, name: "A.* Suite", description: "", capacity: 2, facilities: ["Pool"],
      nightlyPriceMinor: 25000, currency: "INR", totalInventory: 4, active: true,
      inventoryVersion: 3, version: 2, createdAt: new Date(0), updatedAt: new Date(0),
    };
    let findFilter: Filter<RoomTypeDocument> | undefined;
    let countFilter: Filter<RoomTypeDocument> | undefined;
    let seenSort: unknown;
    let seenSkip: number | undefined;
    let seenLimit: number | undefined;
    const collection = {
      find: (filter: Filter<RoomTypeDocument>) => {
        findFilter = filter;
        return {
          sort(sort: unknown) { seenSort = sort; return this; },
          skip(value: number) { seenSkip = value; return this; },
          limit(value: number) { seenLimit = value; return this; },
          toArray: async () => [document],
        };
      },
      countDocuments: async (filter: Filter<RoomTypeDocument>) => { countFilter = filter; return 21; },
    } as unknown as Collection<RoomTypeDocument>;
    const database = { collections: { roomTypes: collection } } as unknown as Database;
    const repository = new MongoRoomTypeReadRepository(database);
    const result = await repository.list({ page: 2, limit: 10, active: true, namePrefix: "A.*", minimumCapacity: 2, facility: "Pool", sort: "price", direction: "desc" });

    expect(findFilter).toEqual({ active: true, capacity: { $gte: 2 }, facilities: "Pool", name: { $regex: "^A\\.\\*" } });
    expect(countFilter).toEqual(findFilter);
    expect(seenSort).toEqual({ nightlyPriceMinor: -1, _id: -1 });
    expect(seenSkip).toBe(10);
    expect(seenLimit).toBe(10);
    expect(result.data[0]?.id).toBe(id.toHexString());
    expect(result.data[0]?.nightlyPrice).toEqual({ amountMinor: 25000, currency: "INR" });
    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 });
  });
});
