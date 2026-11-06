import express, { type Express, type RequestHandler } from "express";
import { errorHandler, requestId, requestLogger } from "./shared/http.js";

export interface ApiRouteHandlers {
  readonly auth?: RequestHandler;
  readonly availability?: RequestHandler;
  readonly roomTypes?: RequestHandler;
  readonly reservations?: RequestHandler;
  /** Multiple independent feature routers share the common staff URL prefix. */
  readonly staff?: RequestHandler | readonly RequestHandler[];
}
export interface AppOptions { routes?: ApiRouteHandlers; readiness?: () => Promise<boolean> }
/** Builds the HTTP app without opening a listener or database; only injected, implemented routers are mounted. */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId, requestLogger, express.json({ limit: "32kb", strict: true }));
  app.get("/api/v1/health/live", (_req, res) => res.json({ data: { status: "live" }, requestId: res.locals.requestId }));
  app.get("/api/v1/health/ready", async (_req, res) => {
    let ready = false;
    try { ready = options.readiness ? await options.readiness() : false; } catch { ready = false; }
    if (!ready) return res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE", message: "Service is not ready.", details: {} }, requestId: res.locals.requestId });
    return res.json({ data: { status: "ready" }, requestId: res.locals.requestId });
  });
  const routes = options.routes ?? {};
  if (routes.auth) app.use("/api/v1/auth", routes.auth);
  if (routes.availability) app.use("/api/v1/availability", routes.availability);
  if (routes.roomTypes) app.use("/api/v1/room-types", routes.roomTypes);
  if (routes.reservations) app.use("/api/v1/reservations", routes.reservations);
  const staffRoutes = routes.staff === undefined ? [] : Array.isArray(routes.staff) ? routes.staff : [routes.staff];
  for (const handler of staffRoutes) app.use("/api/v1/staff", handler);
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route is not implemented.", details: {} }, requestId: res.locals.requestId }));
  app.use(errorHandler);
  return app;
}
