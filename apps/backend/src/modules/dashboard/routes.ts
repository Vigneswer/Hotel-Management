import { DashboardDtoSchema } from "@hotel/contracts";
import type { RequestHandler } from "express";
import { Router } from "express";
import { z } from "zod";
import type { StaffDashboardService } from "./service.js";

export interface DashboardRouteDependencies { readonly service: StaffDashboardService; readonly requireActor: RequestHandler; readonly requireStaff: RequestHandler; }
const StaffDashboardResponseSchema = DashboardDtoSchema.extend({
  missedArrivals: z.number().int().nonnegative().optional(),
  overdueDepartures: z.number().int().nonnegative().optional(),
});

/** Mount at `/api/v1/staff`; the endpoint is `/dashboard`. */
export function createDashboardRoutes(dependencies: DashboardRouteDependencies): RequestHandler {
  const router = Router();
  router.use(dependencies.requireActor, dependencies.requireStaff);
  router.get("/dashboard", (req, res, next) => {
    void dependencies.service.getSummary().then((metrics) => {
      res.json({ data: StaffDashboardResponseSchema.parse(metrics), requestId: res.locals.requestId });
    }).catch(next);
  });
  return router;
}
