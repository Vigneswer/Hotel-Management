import { describe, expect, it } from "vitest";
import type { RoomTypePage, RoomTypePageQuery, RoomTypeReadRepository } from "./read-service.js";
import { RoomTypeCatalogService } from "./read-service.js";

const emptyPage: RoomTypePage = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

describe("RoomTypeCatalogService", () => {
  it("forces the public catalog to active room types", async () => {
    let received: RoomTypePageQuery | undefined;
    const repository: RoomTypeReadRepository = {
      list: async (query) => { received = query; return emptyPage; },
      findById: async () => null,
    };
    const service = new RoomTypeCatalogService(repository);
    await service.listPublic({ page: 2, limit: 10, sort: "name", direction: "asc", minimumCapacity: 2 });
    expect(received?.active).toBe(true);
    expect(received?.minimumCapacity).toBe(2);
  });

  it("supports staff filtering without making inactive types public", async () => {
    let received: RoomTypePageQuery | undefined;
    const repository: RoomTypeReadRepository = {
      list: async (query) => { received = query; return emptyPage; },
      findById: async () => ({ id: "0123456789abcdef01234567", name: "Room", description: "", capacity: 1, facilities: [], nightlyPrice: { amountMinor: 0, currency: "INR" }, totalInventory: 1, active: false, version: 0, inventoryVersion: 0 }),
    };
    const service = new RoomTypeCatalogService(repository);
    await service.listStaff({ page: 1, limit: 20, sort: "price", direction: "desc", active: false });
    expect(received?.active).toBe(false);
    expect(await service.getPublic("0123456789abcdef01234567")).toBeNull();
  });
});
