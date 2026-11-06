import type { RequestHandler } from "express";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../infra/database.js";
import { createAuthMiddleware } from "../auth/middleware.js";
import type { AuthConfig } from "../auth/types.js";
import type { AuthService } from "../auth/service.js";
import { MongoDashboardRepository } from "./mongo-repository.js";
import { createDashboardRoutes } from "./routes.js";
import { StaffDashboardService } from "./service.js";

export { MongoDashboardRepository } from "./mongo-repository.js";
export { StaffDashboardService } from "./service.js";
export { createDashboardRoutes } from "./routes.js";
export type { DashboardConfig, DashboardRepository, DashboardWarnings, StaffDashboardMetrics } from "./service.js";

/** Compose the staff-only dashboard summary endpoint. Mount routes at `/api/v1/staff`. */
export function createDashboardModule(input: {
  readonly database: Database;
  readonly appConfig: AppConfig;
  readonly authService: AuthService;
  readonly authConfig: AuthConfig;
}): { readonly service: StaffDashboardService; readonly routes: RequestHandler } {
  const service = new StaffDashboardService(new MongoDashboardRepository(input.database), {
    timeZone: input.appConfig.HOTEL_TIME_ZONE,
    clock: () => new Date(),
  });
  const auth = createAuthMiddleware(input.authService, input.authConfig);
  return { service, routes: createDashboardRoutes({ service, requireActor: auth.requireActor, requireStaff: auth.requireStaff }) };
}
