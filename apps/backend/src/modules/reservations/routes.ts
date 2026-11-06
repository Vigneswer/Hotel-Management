import { Router, type Request, type RequestHandler, type Response } from "express";
import {
  AuditEventDtoSchema, CancelReservationRequestSchema, ConfirmReservationRequestSchema, CreateReservationRequestSchema,
  IdSchema, LifecycleRequestSchema, OperationKeySchema, PageSchema, ReservationDtoSchema,
} from "@hotel/contracts";
import { z } from "zod";
import { CommandError, type ReservationCommandService } from "./commands.js";
import { DomainPolicyError } from "./policies/dates.js";
import { ReservationQueryService } from "./queries.js";

const listQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "CHECKED_IN", "CHECKED_OUT"]).optional() }).strict();
const staffListQuery = listQuery.extend({
  reference: z.string().trim().min(1).max(32).optional(), roomTypeId: IdSchema.optional(),
  guestEmail: z.string().trim().email().max(254).optional(), checkInFrom: z.string().optional(), checkInTo: z.string().optional(),
  checkOutFrom: z.string().optional(), checkOutTo: z.string().optional(),
}).strict();
const auditQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const cancelBody = CancelReservationRequestSchema.extend({ expectedVersion: z.number().int().nonnegative() }).strict();
const staffCancelBody = CancelReservationRequestSchema.extend({ expectedVersion: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(500) }).strict();

export interface ReservationRouteDependencies {
  readonly commands: ReservationCommandService;
  readonly queries: ReservationQueryService;
  readonly requireActor: RequestHandler;
  readonly requireStaff: RequestHandler;
  readonly verifyCsrf: RequestHandler;
}

/** Mount at /api/v1/reservations. Guest ownership is filtered in the query service. */
export function createReservationRoutes(dependencies: ReservationRouteDependencies): RequestHandler {
  const router = Router();
  router.get("/me", dependencies.requireActor, asyncHandler(async (req, res) => {
    const parsed = listQuery.parse(req.query);
    const page = await dependencies.queries.listMine(actor(req).userId, { page: parsed.page, limit: parsed.limit, ...(parsed.status === undefined ? {} : { status: parsed.status }) });
    res.json({ ...PageSchema(ReservationDtoSchema).parse({ ...page, requestId: res.locals.requestId }), requestId: res.locals.requestId });
  }));
  router.post("/", dependencies.requireActor, dependencies.verifyCsrf, asyncHandler(async (req, res) => {
    const body = CreateReservationRequestSchema.parse(req.body);
    const result = await dependencies.commands.createPending({ ...body, ...meta(req) });
    res.status(201).json({ data: ReservationDtoSchema.parse(result), requestId: res.locals.requestId });
  }));
  router.post("/:id/cancel", dependencies.requireActor, dependencies.verifyCsrf, asyncHandler(async (req, res) => {
    const body = cancelBody.parse(req.body);
    const result = await dependencies.commands.cancel({ expectedVersion: body.expectedVersion, ...(body.reason === undefined ? {} : { reason: body.reason }), reservationId: IdSchema.parse(req.params.id), ...meta(req) });
    res.json({ data: ReservationDtoSchema.parse(result), requestId: res.locals.requestId });
  }));
  router.get("/:id", dependencies.requireActor, asyncHandler(async (req, res) => {
    const result = await dependencies.queries.getById(IdSchema.parse(req.params.id), actor(req));
    if (!result) { res.status(404).json(errorBody(res, 404, "NOT_FOUND", "Reservation was not found.")); return; }
    res.json({ data: ReservationDtoSchema.parse(result), requestId: res.locals.requestId });
  }));
  return router;
}

/** Mount below /api/v1/staff/reservations inside the staff route composition. */
export function createStaffReservationRoutes(dependencies: ReservationRouteDependencies): RequestHandler {
  const router = Router();
  router.use(dependencies.requireActor, dependencies.requireStaff);
  router.get("/", asyncHandler(async (req, res) => {
    const parsed = staffListQuery.parse(req.query);
    const page = await dependencies.queries.listStaff({
      page: parsed.page, limit: parsed.limit,
      ...(parsed.status === undefined ? {} : { status: parsed.status }),
      ...(parsed.reference === undefined ? {} : { reference: parsed.reference }),
      ...(parsed.roomTypeId === undefined ? {} : { roomTypeId: parsed.roomTypeId }),
      ...(parsed.guestEmail === undefined ? {} : { guestEmail: parsed.guestEmail }),
      ...(parsed.checkInFrom === undefined ? {} : { checkInFrom: parsed.checkInFrom }),
      ...(parsed.checkInTo === undefined ? {} : { checkInTo: parsed.checkInTo }),
      ...(parsed.checkOutFrom === undefined ? {} : { checkOutFrom: parsed.checkOutFrom }),
      ...(parsed.checkOutTo === undefined ? {} : { checkOutTo: parsed.checkOutTo }),
    });
    res.json({ ...PageSchema(ReservationDtoSchema).parse({ ...page, requestId: res.locals.requestId }), requestId: res.locals.requestId });
  }));
  router.get("/:id/audit", asyncHandler(async (req, res) => {
    const parsed = auditQuery.parse(req.query);
    const page = await dependencies.queries.listAudit(IdSchema.parse(req.params.id), parsed.page, parsed.limit);
    res.json({ ...PageSchema(AuditEventDtoSchema).parse({ ...page, requestId: res.locals.requestId }), requestId: res.locals.requestId });
  }));
  router.get("/:id", asyncHandler(async (req, res) => {
    const result = await dependencies.queries.getById(IdSchema.parse(req.params.id), actor(req));
    if (!result) { res.status(404).json(errorBody(res, 404, "NOT_FOUND", "Reservation was not found.")); return; }
    res.json({ data: ReservationDtoSchema.parse(result), requestId: res.locals.requestId });
  }));
  router.post("/:id/confirm", dependencies.verifyCsrf, asyncHandler(async (req, res) => {
    const body = ConfirmReservationRequestSchema.parse(req.body);
    const result = await dependencies.commands.confirm({ ...body, reservationId: IdSchema.parse(req.params.id), ...meta(req) });
    res.json({ data: ReservationDtoSchema.parse(result), requestId: res.locals.requestId });
  }));
  router.post("/:id/cancel", dependencies.verifyCsrf, asyncHandler(async (req, res) => {
    const body = staffCancelBody.parse(req.body);
    const result = await dependencies.commands.cancel({ ...body, reservationId: IdSchema.parse(req.params.id), ...meta(req) });
    res.json({ data: ReservationDtoSchema.parse(result), requestId: res.locals.requestId });
  }));
  router.post("/:id/check-in", dependencies.verifyCsrf, asyncHandler(async (req, res) => {
    const body = LifecycleRequestSchema.parse(req.body);
    const result = await dependencies.commands.checkIn({ ...body, reservationId: IdSchema.parse(req.params.id), ...meta(req) });
    res.json({ data: ReservationDtoSchema.parse(result), requestId: res.locals.requestId });
  }));
  router.post("/:id/check-out", dependencies.verifyCsrf, asyncHandler(async (req, res) => {
    const body = LifecycleRequestSchema.parse(req.body);
    const result = await dependencies.commands.checkOut({ ...body, reservationId: IdSchema.parse(req.params.id), ...meta(req) });
    res.json({ data: ReservationDtoSchema.parse(result), requestId: res.locals.requestId });
  }));
  return router;
}

function actor(req: Request): { readonly userId: string; readonly role: "GUEST" | "STAFF" } {
  if (!req.auth) throw new CommandError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return req.auth.actor;
}
function meta(req: Request) {
  const operationKey = OperationKeySchema.parse(req.header("Idempotency-Key"));
  return { actor: actor(req), operationKey, requestId: typeof req.res?.locals.requestId === "string" ? req.res.locals.requestId : "unknown" };
}
function asyncHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch((error: unknown) => {
      if (error instanceof CommandError) { res.status(error.status).json(errorBody(res, error.status, error.code, error.message)); return; }
      if (error instanceof DomainPolicyError) { const status = error.code === "NOT_FOUND" ? 404 : 400; res.status(status).json(errorBody(res, status, error.code === "NOT_FOUND" ? error.code : "VALIDATION_ERROR", error.message)); return; }
      if (error instanceof z.ZodError) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed.", details: { issues: error.issues.map(({ path, code }) => ({ path, code })) } }, requestId: res.locals.requestId }); return; }
      next(error);
    });
  };
}
function errorBody(res: Response, status: number, code: string, message: string): object {
  res.status(status);
  return { error: { code, message, details: {} }, requestId: res.locals.requestId };
}
