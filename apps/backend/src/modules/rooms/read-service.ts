import type { RoomTypeDto } from "@hotel/contracts";

export interface RoomTypeFilters {
  readonly namePrefix?: string;
  readonly minimumCapacity?: number;
  readonly facility?: string;
  readonly active: true | false | "all";
  readonly sort: "name" | "price";
  readonly direction: "asc" | "desc";
}
export interface RoomTypePageQuery extends RoomTypeFilters { readonly page: number; readonly limit: number; }
export interface RoomTypePage { readonly data: readonly RoomTypeDto[]; readonly pagination: { readonly page: number; readonly limit: number; readonly total: number; readonly totalPages: number }; }
export interface RoomTypeReadRepository {
  list(query: RoomTypePageQuery): Promise<RoomTypePage>;
  findById(id: string): Promise<RoomTypeDto | null>;
}

export class RoomTypeCatalogService {
  constructor(private readonly repository: RoomTypeReadRepository) {}

  listPublic(query: Omit<RoomTypePageQuery, "active">): Promise<RoomTypePage> {
    return this.repository.list({ ...query, active: true });
  }

  listStaff(query: RoomTypePageQuery): Promise<RoomTypePage> {
    return this.repository.list(query);
  }

  async getPublic(id: string): Promise<RoomTypeDto | null> {
    const roomType = await this.repository.findById(id);
    return roomType?.active ? roomType : null;
  }
}
