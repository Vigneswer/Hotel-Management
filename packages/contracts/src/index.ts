import { z } from "zod";

export const RoleSchema = z.enum(["GUEST", "STAFF"]);
export type Role = z.infer<typeof RoleSchema>;
export const ReservationStatusSchema = z.enum(["PENDING", "CONFIRMED", "CANCELLED", "CHECKED_IN", "CHECKED_OUT"]);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;
export const IdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const MoneySchema = z.object({ amountMinor: z.number().int().nonnegative().safe(), currency: z.string().length(3) });

export const PageQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export const PaginationSchema = z.object({ page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export const PageSchema = <T extends z.ZodType>(data: T) => z.object({ data: z.array(data), pagination: PaginationSchema, requestId: z.string() });
export const ApiErrorCodeSchema = z.enum(["VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "INVENTORY_UNAVAILABLE", "VERSION_CONFLICT", "STATE_CONFLICT", "IDEMPOTENCY_CONFLICT", "PRICE_CHANGED", "RATE_LIMITED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]);
export const ApiErrorSchema = z.object({ error: z.object({ code: ApiErrorCodeSchema, message: z.string(), details: z.record(z.string(), z.unknown()).default({}) }), requestId: z.string() });

export const UserDtoSchema = z.object({ id: IdSchema, name: z.string(), email: z.string().email(), role: RoleSchema });
export type UserDto = z.infer<typeof UserDtoSchema>;
export const RoomTypeDtoSchema = z.object({ id: IdSchema, name: z.string(), description: z.string(), capacity: z.number().int().positive(), facilities: z.array(z.string()), nightlyPrice: MoneySchema, totalInventory: z.number().int().nonnegative(), active: z.boolean(), version: z.number().int().nonnegative(), inventoryVersion: z.number().int().nonnegative(), imageUrl: z.string().url().optional() });
export type RoomTypeDto = z.infer<typeof RoomTypeDtoSchema>;
export const ReservationDtoSchema = z.object({ id: IdSchema, guestId: IdSchema, roomTypeId: IdSchema, guestCount: z.number().int().positive(), roomCount: z.literal(1), checkInDate: DateOnlySchema, checkOutDate: DateOnlySchema, status: ReservationStatusSchema, priceSnapshot: MoneySchema, nights: z.number().int().positive(), total: MoneySchema, version: z.number().int().nonnegative(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
export type ReservationDto = z.infer<typeof ReservationDtoSchema>;
export const QuoteDtoSchema = z.object({ roomTypeId: IdSchema, checkInDate: DateOnlySchema, checkOutDate: DateOnlySchema, guestCount: z.number().int().positive(), nights: z.number().int().positive(), nightlyPrice: MoneySchema, total: MoneySchema, quoteVersion: z.number().int().nonnegative() });
export type QuoteDto = z.infer<typeof QuoteDtoSchema>;
export const DashboardDtoSchema = z.object({ arrivals: z.number().int().nonnegative(), departures: z.number().int().nonnegative(), occupiedRooms: z.number().int().nonnegative(), pendingReservations: z.number().int().nonnegative(), missedArrivals: z.number().int().nonnegative().optional(), overdueDepartures: z.number().int().nonnegative().optional() });
export type DashboardDto = z.infer<typeof DashboardDtoSchema>;
export const AuditEventDtoSchema = z.object({ id: IdSchema, reservationId: IdSchema, actorId: IdSchema, action: z.string(), reason: z.string().optional(), createdAt: z.string().datetime() });
export type AuditEventDto = z.infer<typeof AuditEventDtoSchema>;

const commonStay = { roomTypeId: IdSchema, checkInDate: DateOnlySchema, checkOutDate: DateOnlySchema, guestCount: z.number().int().positive() };
export const CreateReservationRequestSchema = z.object({ ...commonStay, quoteVersion: z.number().int().nonnegative() }).strict();
export type CreateReservationRequest = z.infer<typeof CreateReservationRequestSchema>;
export const OperationKeySchema = z.string().uuid();
export const ExpectedVersionSchema = z.number().int().nonnegative();
export const CancelReservationRequestSchema = z.object({ reason: z.string().trim().min(1).max(500).optional(), expectedVersion: ExpectedVersionSchema.optional() }).strict();
export const ConfirmReservationRequestSchema = z.object({ expectedVersion: ExpectedVersionSchema }).strict();
export const LifecycleRequestSchema = z.object({ expectedVersion: ExpectedVersionSchema }).strict();
export const RoomTypeWriteSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(2000), capacity: z.number().int().positive(), facilities: z.array(z.string().trim().min(1).max(60)).max(30), nightlyPrice: MoneySchema, totalInventory: z.number().int().nonnegative(), imageUrl: z.string().url().optional() }).strict();
export const RoomTypeUpdateSchema = RoomTypeWriteSchema.partial().extend({ expectedVersion: ExpectedVersionSchema }).strict();

export interface Actor { readonly userId: string; readonly role: Role }
export interface AuthenticatedSession { readonly actor: Actor; readonly sessionId: string }
export type AuthMiddlewareHandler = (request: unknown, response: unknown, next: (error?: unknown) => void) => void;
export interface AuthMiddleware { requireActor: AuthMiddlewareHandler; requireStaff: AuthMiddlewareHandler; verifyCsrf: AuthMiddlewareHandler; issueCsrfBootstrap: AuthMiddlewareHandler }
export interface SessionService { current(cookieToken: string | undefined): Promise<AuthenticatedSession | null>; revoke(sessionId: string): Promise<void> }
export interface TransactionContext { readonly session: unknown }
export interface ReservationRepository {
  findById(id: string, tx: TransactionContext): Promise<ReservationDto | null>;
  insert(input: ReservationDto, tx: TransactionContext): Promise<void>;
  replace(input: ReservationDto, expectedVersion: number, tx: TransactionContext): Promise<boolean>;
}
export interface RoomTypeRepository {
  findById(id: string, tx: TransactionContext): Promise<RoomTypeDto | null>;
  insert(input: RoomTypeDto, tx: TransactionContext): Promise<void>;
  replace(input: RoomTypeDto, expectedVersion: number, tx: TransactionContext): Promise<boolean>;
}
/** requestId is internal tracing metadata from HTTP context, never accepted from user payloads. */
export interface CommandMeta { readonly actor: Actor; readonly operationKey: string; readonly requestId?: string }
export interface ReservationCommands {
  createPending(input: CreateReservationRequest & CommandMeta): Promise<ReservationDto>;
  confirm(input: CommandMeta & { reservationId: string; expectedVersion: number }): Promise<ReservationDto>;
  cancel(input: CommandMeta & { reservationId: string; expectedVersion: number; reason?: string }): Promise<ReservationDto>;
  checkIn(input: CommandMeta & { reservationId: string; expectedVersion: number }): Promise<ReservationDto>;
  checkOut(input: CommandMeta & { reservationId: string; expectedVersion: number }): Promise<ReservationDto>;
}
export interface RoomCommands {
  create(input: CommandMeta & { roomType: z.infer<typeof RoomTypeWriteSchema> }): Promise<RoomTypeDto>;
  update(input: CommandMeta & { roomTypeId: string; expectedVersion: number; patch: z.infer<typeof RoomTypeUpdateSchema> }): Promise<RoomTypeDto>;
  deactivate(input: CommandMeta & { roomTypeId: string; expectedVersion: number }): Promise<RoomTypeDto>;
  activate(input: CommandMeta & { roomTypeId: string; expectedVersion: number }): Promise<RoomTypeDto>;
}
export interface OperationRecord { readonly actorId: string; readonly operationKey: string; readonly requestHash: string; readonly resultId: string }

