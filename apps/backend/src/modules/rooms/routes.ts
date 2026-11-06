import { IdSchema, PageSchema, RoomTypeDtoSchema } from "@hotel/contracts";
import type { RequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import type { RoomTypeCatalogService, RoomTypePageQuery } from "./read-service.js";

const paging = {
  page: z.string().regex(/^[1-9]\d{0,5}$/).optional().transform((value) => Number(value ?? "1")),
  limit: z.string().regex(/^(?:[1-9]\d?|100)$/).optional().transform((value) => Number(value ?? "20")),
  namePrefix: z.string().trim().min(1).max(80).optional(),
  minimumCapacity: z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).refine((value) => value <= 1000, "Capacity cannot exceed 1000.").optional(),
  facility: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(["name", "price"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
};
const publicQuery = z.object(paging).strict().refine(({ page, limit }) => (page - 1) * limit <= 10_000, "Page offset is too large.");
const staffQuery = z.object({ ...paging, active: z.enum(["all", "active", "inactive"]).default("all") }).strict().refine(({ page, limit }) => (page - 1) * limit <= 10_000, "Page offset is too large.");

export interface RoomCatalogRouteDependencies {
  readonly service: RoomTypeCatalogService;
  readonly requireActor?: RequestHandler;
  readonly requireStaff?: RequestHandler;
}

/** Mount at `/api/v1/room-types`. Only active room types are ever exposed here. */
export function createRoomCatalogRoutes(dependencies: RoomCatalogRouteDependencies): RequestHandler {
  const router = Router();
  router.get("/", (req, res, next) => {
    const query = publicQuery.safeParse(req.query);
    if (!query.success) { res.status(400).json(validationError(res, query.error)); return; }
    void dependencies.service.listPublic(toPageFilters(query.data)).then((page) => {
      res.json(PageSchema(RoomTypeDtoSchema).parse({ ...page, requestId: res.locals.requestId }));
    }).catch(next);
  });
  router.get("/:id", (req, res, next) => {
    const parsedId = IdSchema.safeParse(req.params.id);
    if (!parsedId.success) { res.status(400).json(validationError(res, parsedId.error)); return; }
    void dependencies.service.getPublic(parsedId.data).then((roomType) => {
      if (!roomType) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Room type was not found.", details: {} }, requestId: res.locals.requestId }); return; }
      res.json({ data: RoomTypeDtoSchema.parse(roomType), requestId: res.locals.requestId });
    }).catch(next);
  });
  return router;
}

/** Mount at `/api/v1/staff`; expose active and inactive catalog pages only to staff. */
export function createStaffRoomReadRoutes(dependencies: Required<RoomCatalogRouteDependencies>): RequestHandler {
  const router = Router();
  router.use(dependencies.requireActor, dependencies.requireStaff);
  router.get("/room-types", (req, res, next) => {
    const parsed = staffQuery.safeParse(req.query);
    if (!parsed.success) { res.status(400).json(validationError(res, parsed.error)); return; }
    const filters = toPageFilters(parsed.data);
    const active = parsed.data.active === "all" ? "all" : parsed.data.active === "active";
    void dependencies.service.listStaff({ ...filters, active }).then((page) => {
      res.json(PageSchema(RoomTypeDtoSchema).parse({ ...page, requestId: res.locals.requestId }));
    }).catch(next);
  });
  return router;
}

function toPageFilters(parsed: z.infer<typeof publicQuery>): Omit<RoomTypePageQuery, "active"> {
  return {
    page: parsed.page, limit: parsed.limit,
    sort: parsed.sort, direction: parsed.direction,
    ...(parsed.namePrefix === undefined ? {} : { namePrefix: parsed.namePrefix }),
    ...(parsed.minimumCapacity === undefined ? {} : { minimumCapacity: parsed.minimumCapacity }),
    ...(parsed.facility === undefined ? {} : { facility: parsed.facility }),
  };
}

function validationError(res: Parameters<RequestHandler>[1], error: z.ZodError): object {
  return { error: { code: "VALIDATION_ERROR", message: "Invalid room type query.", details: { issues: error.issues.map(({ path, code }) => ({ path, code })) } }, requestId: res.locals.requestId };
}
