import {
  ExpectedVersionSchema, IdSchema, OperationKeySchema, RoomTypeDtoSchema, RoomTypeUpdateSchema, RoomTypeWriteSchema,
  type Actor, type RoomCommands,
} from "@hotel/contracts";
import type { RequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";

const DeactivateSchema = z.object({ expectedVersion: ExpectedVersionSchema }).strict();

export interface StaffRoomCommandRouteDependencies {
  readonly commands: RoomCommands;
  readonly requireActor: RequestHandler;
  readonly requireStaff: RequestHandler;
  readonly verifyCsrf: RequestHandler;
}

/**
 * HTTP-only adapter for L2's guarded RoomCommands. Mount at `/api/v1/staff`
 * after L2 publishes its command service. This module contains no room writes.
 */
export function createStaffRoomCommandRoutes(dependencies: StaffRoomCommandRouteDependencies): RequestHandler {
  const router = Router();
  router.use(dependencies.requireActor, dependencies.requireStaff);
  router.post("/room-types", dependencies.verifyCsrf, async (req, res, next) => {
    const parsed = RoomTypeWriteSchema.safeParse(req.body);
    const operationKey = parseOperationKey(req, res);
    if (!parsed.success) { res.status(400).json(validationError(res, parsed.error)); return; }
    if (!operationKey) return;
    try {
      const created = await dependencies.commands.create({ actor: actorFromRequest(req), requestId: requestIdFromResponse(res), operationKey, roomType: parsed.data });
      res.status(201).json({ data: RoomTypeDtoSchema.parse(created), requestId: res.locals.requestId });
    } catch (error) { next(error); }
  });
  router.patch("/room-types/:id", dependencies.verifyCsrf, async (req, res, next) => {
    const id = IdSchema.safeParse(req.params.id);
    const parsed = RoomTypeUpdateSchema.safeParse(req.body);
    const operationKey = parseOperationKey(req, res);
    if (!id.success) { res.status(400).json(validationError(res, id.error)); return; }
    if (!parsed.success) { res.status(400).json(validationError(res, parsed.error)); return; }
    if (!operationKey) return;
    try {
      const updated = await dependencies.commands.update({
        actor: actorFromRequest(req), requestId: requestIdFromResponse(res), operationKey,
        roomTypeId: id.data, expectedVersion: parsed.data.expectedVersion, patch: parsed.data,
      });
      res.json({ data: RoomTypeDtoSchema.parse(updated), requestId: res.locals.requestId });
    } catch (error) { next(error); }
  });
  router.post("/room-types/:id/deactivate", dependencies.verifyCsrf, async (req, res, next) => {
    const id = IdSchema.safeParse(req.params.id);
    const parsed = DeactivateSchema.safeParse(req.body);
    const operationKey = parseOperationKey(req, res);
    if (!id.success) { res.status(400).json(validationError(res, id.error)); return; }
    if (!parsed.success) { res.status(400).json(validationError(res, parsed.error)); return; }
    if (!operationKey) return;
    try {
      const updated = await dependencies.commands.deactivate({
        actor: actorFromRequest(req), requestId: requestIdFromResponse(res), operationKey,
        roomTypeId: id.data, expectedVersion: parsed.data.expectedVersion,
      });
      res.json({ data: RoomTypeDtoSchema.parse(updated), requestId: res.locals.requestId });
    } catch (error) { next(error); }
  });
  router.post("/room-types/:id/activate", dependencies.verifyCsrf, async (req, res, next) => {
    const id = IdSchema.safeParse(req.params.id);
    const parsed = DeactivateSchema.safeParse(req.body);
    const operationKey = parseOperationKey(req, res);
    if (!id.success) { res.status(400).json(validationError(res, id.error)); return; }
    if (!parsed.success) { res.status(400).json(validationError(res, parsed.error)); return; }
    if (!operationKey) return;
    try {
      const updated = await dependencies.commands.activate({
        actor: actorFromRequest(req), requestId: requestIdFromResponse(res), operationKey,
        roomTypeId: id.data, expectedVersion: parsed.data.expectedVersion,
      });
      res.json({ data: RoomTypeDtoSchema.parse(updated), requestId: res.locals.requestId });
    } catch (error) { next(error); }
  });
  return router;
}

function actorFromRequest(req: Parameters<RequestHandler>[0]): Actor {
  const actor = req.auth?.actor;
  if (!actor) throw Object.assign(new Error("Authentication is required."), { status: 401 });
  return actor;
}
function requestIdFromResponse(res: Parameters<RequestHandler>[1]): string {
  return typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
}
function parseOperationKey(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]): string | null {
  const parsed = OperationKeySchema.safeParse(req.get("idempotency-key"));
  if (!parsed.success) { res.status(400).json(validationError(res, parsed.error)); return null; }
  return parsed.data;
}
function validationError(res: Parameters<RequestHandler>[1], error: z.ZodError): object {
  return { error: { code: "VALIDATION_ERROR", message: "Invalid room type request.", details: { issues: error.issues.map(({ path, code }) => ({ path, code })) } }, requestId: res.locals.requestId };
}
