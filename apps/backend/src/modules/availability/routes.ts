import { Router, type RequestHandler } from "express";
import { QuoteDtoSchema } from "@hotel/contracts";
import { z } from "zod";
import { DomainPolicyError } from "../reservations/policies/dates.js";
import { AvailabilityNotFoundError, AvailabilityService } from "./service.js";

const quoteQuery = z.object({
  roomTypeId: z.string().regex(/^[a-f\d]{24}$/i),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  guestCount: z.coerce.number().int().positive(),
}).strict();
const searchQuery = z.object({
  checkInDate: z.string(),
  checkOutDate: z.string(),
  guestCount: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(512).optional(),
}).strict();

function respondError(error: unknown, res: Parameters<RequestHandler>[1]): void {
  const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid availability query.", details: { issues: error.issues } }, requestId });
    return;
  }
  if (error instanceof AvailabilityNotFoundError) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: error.message, details: {} }, requestId });
    return;
  }
  if (error instanceof DomainPolicyError) {
    const status = error instanceof DomainPolicyError && error.code === "FORBIDDEN" ? 403 : 400;
    res.status(status).json({ error: { code: error.code, message: error.message, details: {} }, requestId });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", details: {} }, requestId });
}

export interface AvailabilityRouteDependencies { readonly service: AvailabilityService }

/** Mount at /api/v1/availability through the app's route registry. */
export function createAvailabilityRoutes(dependencies: AvailabilityRouteDependencies): RequestHandler {
  const router = Router();
  router.get("/quote", (req, res) => {
    const parsed = quoteQuery.safeParse(req.query);
    if (!parsed.success) { respondError(parsed.error, res); return; }
    void dependencies.service.quote(parsed.data).then((quote) => {
      res.json({ data: QuoteDtoSchema.parse(quote), requestId: res.locals.requestId });
    }).catch((error: unknown) => respondError(error, res));
  });
  router.get("/", (req, res) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) { respondError(parsed.error, res); return; }
    void dependencies.service.search({ ...parsed.data, cursor: parsed.data.cursor ?? null }).then((result) => {
      res.json({ ...result, requestId: res.locals.requestId });
    }).catch((error: unknown) => respondError(error, res));
  });
  return router;
}
