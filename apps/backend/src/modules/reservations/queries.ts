import { ObjectId, type Filter } from "mongodb";
import { AuditEventDtoSchema, IdSchema, ReservationStatusSchema, type AuditEventDto, type ReservationDto, type ReservationStatus, type Role } from "@hotel/contracts";
import type { Database, ReservationDocument } from "../../infra/database.js";
import { DomainPolicyError, parseCalendarDate } from "./policies/dates.js";
import { toReservationDto } from "./commands.js";

export interface ReservationPage<T> { readonly data: readonly T[]; readonly pagination: { readonly page: number; readonly limit: number; readonly total: number; readonly totalPages: number } }
export interface ReservationListQuery { readonly page: number; readonly limit: number; readonly status?: ReservationStatus }
export interface StaffReservationQuery extends ReservationListQuery {
  readonly reference?: string;
  readonly roomTypeId?: string;
  readonly guestEmail?: string;
  readonly checkInFrom?: string;
  readonly checkInTo?: string;
  readonly checkOutFrom?: string;
  readonly checkOutTo?: string;
}

export class ReservationQueryService {
  constructor(private readonly database: Database) {}

  async listMine(guestId: string, query: ReservationListQuery): Promise<ReservationPage<ReservationDto>> {
    const id = parseId(guestId);
    const filter: Filter<ReservationDocument> = { guestId: id, ...statusFilter(query.status) };
    return this.list(filter, query.page, query.limit);
  }

  async listStaff(query: StaffReservationQuery): Promise<ReservationPage<ReservationDto>> {
    const filter: Filter<ReservationDocument> = { ...statusFilter(query.status) };
    if (query.reference) filter.reference = query.reference.trim().toUpperCase();
    if (query.roomTypeId) filter.roomTypeId = parseId(query.roomTypeId);
    if (query.checkInFrom || query.checkInTo) {
      filter.checkInDate = { ...(query.checkInFrom ? { $gte: date(query.checkInFrom) } : {}), ...(query.checkInTo ? { $lte: date(query.checkInTo) } : {}) };
    }
    if (query.checkOutFrom || query.checkOutTo) {
      filter.checkOutDate = { ...(query.checkOutFrom ? { $gte: date(query.checkOutFrom) } : {}), ...(query.checkOutTo ? { $lte: date(query.checkOutTo) } : {}) };
    }
    if (query.guestEmail) {
      const email = query.guestEmail.trim().normalize("NFKC").toLocaleLowerCase("en-US");
      const user = await this.database.collections.users.findOne({ emailNormalized: email }, { projection: { _id: 1 } });
      if (!user) return emptyPage(query.page, query.limit);
      filter.guestId = user._id;
    }
    return this.list(filter, query.page, query.limit);
  }

  async getById(id: string, actor: { readonly userId: string; readonly role: Role }): Promise<ReservationDto | null> {
    const reservationId = parseId(id);
    const filter: Filter<ReservationDocument> = { _id: reservationId };
    if (actor.role === "GUEST") filter.guestId = parseId(actor.userId);
    const document = await this.database.collections.reservations.findOne(filter);
    return document ? toReservationDto(document) : null;
  }

  async listAudit(reservationId: string, page: number, limit: number): Promise<ReservationPage<AuditEventDto>> {
    const id = parseId(reservationId);
    validatePage(page, limit);
    const reservation = await this.database.collections.reservations.findOne({ _id: id }, { projection: { _id: 1 } });
    if (!reservation) throw new DomainPolicyError("Reservation was not found.", "NOT_FOUND");
    const filter = { entityType: "RESERVATION", entityId: id } as const;
    const [documents, total] = await Promise.all([
      this.database.collections.auditEvents.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      this.database.collections.auditEvents.countDocuments(filter),
    ]);
    const data = documents.map((event) => AuditEventDtoSchema.parse({
      id: event._id.toHexString(), reservationId: event.entityId.toHexString(), actorId: event.actorId.toHexString(),
      action: event.action, ...(event.reason === undefined ? {} : { reason: event.reason }), createdAt: event.createdAt.toISOString(),
    }));
    return pageResult(data, page, limit, total);
  }

  private async list(filter: Filter<ReservationDocument>, page: number, limit: number): Promise<ReservationPage<ReservationDto>> {
    validatePage(page, limit);
    const [documents, total] = await Promise.all([
      this.database.collections.reservations.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      this.database.collections.reservations.countDocuments(filter),
    ]);
    return pageResult(documents.map(toReservationDto), page, limit, total);
  }
}

function statusFilter(status?: ReservationStatus): Pick<Filter<ReservationDocument>, "status"> | Record<string, never> {
  if (status !== undefined) return { status: ReservationStatusSchema.parse(status) };
  return {};
}
function parseId(id: string): ObjectId {
  if (!IdSchema.safeParse(id).success) throw new DomainPolicyError("Identifier is invalid.");
  return new ObjectId(id);
}
function date(value: string): string { parseCalendarDate(value); return value; }
function validatePage(page: number, limit: number): void {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (page - 1) * limit > 10_000) {
    throw new DomainPolicyError("Page or limit is outside the supported range.");
  }
}
function pageResult<T>(data: readonly T[], page: number, limit: number, total: number): ReservationPage<T> {
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
function emptyPage<T>(page: number, limit: number): ReservationPage<T> {
  validatePage(page, limit);
  return pageResult([], page, limit, 0);
}
