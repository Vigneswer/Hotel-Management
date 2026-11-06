import type { RequestHandler } from "express";
import { Router } from "express";
import { createAuthMiddleware } from "../auth/middleware.js";
import type { AuthConfig } from "../auth/types.js";
import type { AuthService } from "../auth/service.js";
import type { Database } from "../../infra/database.js";
import { createRoomCommandService, type RoomCommandConfig } from "./commands/service.js";
import { MongoRoomTypeReadRepository } from "./mongo-repository.js";
import { createRoomCatalogRoutes, createStaffRoomReadRoutes } from "./routes.js";
import { RoomTypeCatalogService } from "./read-service.js";
import { createStaffRoomCommandRoutes } from "./command-routes.js";

export { MongoRoomTypeReadRepository, toRoomTypeDto } from "./mongo-repository.js";
export { RoomTypeCatalogService } from "./read-service.js";
export { createRoomCatalogRoutes, createStaffRoomReadRoutes } from "./routes.js";
export { createStaffRoomCommandRoutes } from "./command-routes.js";
export type { RoomCommandConfig } from "./commands/service.js";

export function createRoomCatalogModule(database: Database): { readonly service: RoomTypeCatalogService; readonly routes: RequestHandler } {
  const service = new RoomTypeCatalogService(new MongoRoomTypeReadRepository(database));
  return { service, routes: createRoomCatalogRoutes({ service }) };
}

/** Compose public and staff room routes after T04's guarded command service is available. */
export function createStaffRoomModule(input: {
  readonly database: Database;
  readonly commandConfig: RoomCommandConfig;
  readonly authService: AuthService;
  readonly authConfig: AuthConfig;
}): { readonly service: RoomTypeCatalogService; readonly routes: RequestHandler } {
  const service = new RoomTypeCatalogService(new MongoRoomTypeReadRepository(input.database));
  const auth = createAuthMiddleware(input.authService, input.authConfig);
  const commands = createRoomCommandService(input.database, input.commandConfig);
  const routes = Router();
  routes.use(createStaffRoomReadRoutes({ service, requireActor: auth.requireActor, requireStaff: auth.requireStaff }));
  routes.use(createStaffRoomCommandRoutes({ commands, requireActor: auth.requireActor, requireStaff: auth.requireStaff, verifyCsrf: auth.verifyCsrf }));
  return { service, routes };
}
