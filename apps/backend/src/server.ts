import "./config/load-env.js";
import { Router } from "express";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectDatabase } from "./infra/database.js";
import { authConfigFromApp, createAuthModule } from "./modules/auth/index.js";
import { MongoAvailabilityRepository } from "./modules/availability/mongo-repository.js";
import { AvailabilityService } from "./modules/availability/service.js";
import { createAvailabilityRoutes } from "./modules/availability/routes.js";
import { createRoomCatalogModule } from "./modules/rooms/index.js";
import { createStaffRoomReadRoutes } from "./modules/rooms/routes.js";
import { createStaffRoomCommandRoutes } from "./modules/rooms/command-routes.js";
import { createRoomCommandService } from "./modules/rooms/commands/service.js";
import { MongoDashboardRepository } from "./modules/dashboard/mongo-repository.js";
import { StaffDashboardService } from "./modules/dashboard/service.js";
import { createDashboardRoutes } from "./modules/dashboard/routes.js";
import { createReservationCommandService } from "./modules/reservations/commands.js";
import { ReservationQueryService } from "./modules/reservations/queries.js";
import { createReservationRoutes, createStaffReservationRoutes } from "./modules/reservations/routes.js";

const config = loadConfig();
const database = await connectDatabase(config).catch((error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error && (typeof error.code === "string" || typeof error.code === "number") ? error.code : undefined;
  console.error(JSON.stringify({ event: "database_startup_failed", errorName: error instanceof Error ? error.name : "UnknownError", ...(code === undefined ? {} : { code }) }));
  process.exit(1);
});
const authConfig = authConfigFromApp(config);
const auth = createAuthModule(database, authConfig);
const roomCatalog = createRoomCatalogModule(database);
const availability = createAvailabilityRoutes({ service: new AvailabilityService(new MongoAvailabilityRepository(database), { timeZone: config.HOTEL_TIME_ZONE, clock: () => new Date(), maxScan: 500 }) });
const dashboardService = new StaffDashboardService(new MongoDashboardRepository(database), { timeZone: config.HOTEL_TIME_ZONE, clock: () => new Date() });
const dashboardRoutes = createDashboardRoutes({ service: dashboardService, requireActor: auth.middleware.requireActor, requireStaff: auth.middleware.requireStaff });
const roomCommandConfig = { HOTEL_TIME_ZONE: config.HOTEL_TIME_ZONE, HOTEL_CURRENCY: config.HOTEL_CURRENCY };
const staffRoomRoutes = Router();
staffRoomRoutes.use(createStaffRoomReadRoutes({ service: roomCatalog.service, requireActor: auth.middleware.requireActor, requireStaff: auth.middleware.requireStaff }));
staffRoomRoutes.use(createStaffRoomCommandRoutes({ commands: createRoomCommandService(database, roomCommandConfig), requireActor: auth.middleware.requireActor, requireStaff: auth.middleware.requireStaff, verifyCsrf: auth.middleware.verifyCsrf }));
const reservationConfig = roomCommandConfig;
const reservationDependencies = { commands: createReservationCommandService(database, reservationConfig), queries: new ReservationQueryService(database), requireActor: auth.middleware.requireActor, requireStaff: auth.middleware.requireStaff, verifyCsrf: auth.middleware.verifyCsrf };
const guestReservationRoutes = createReservationRoutes(reservationDependencies);
const staffReservationRoutes = createStaffReservationRoutes(reservationDependencies);
const staffRoutes = Router();
staffRoutes.use(dashboardRoutes, staffRoomRoutes);
staffRoutes.use("/reservations", staffReservationRoutes);
let shuttingDown = false;
const server = createApp({
  routes: { auth: auth.routes, availability, roomTypes: roomCatalog.routes, reservations: guestReservationRoutes, staff: staffRoutes },
  readiness: async () => { if (shuttingDown) return false; await database.db.command({ ping: 1, maxTimeMS: 1_000 }); return true; },
}).listen(config.API_PORT, () => console.log(JSON.stringify({ event: "api_listening", port: config.API_PORT })));
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(JSON.stringify({ event: "http_server_error", errorName: error.name, ...(error.code === undefined ? {} : { code: error.code }) }));
  void database.close().finally(() => process.exit(1));
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: "shutdown_started", signal }));
  const forceTimer = setTimeout(() => {
    console.error(JSON.stringify({ event: "shutdown_deadline_exceeded", timeoutMs: 10_000 }));
    server.closeAllConnections();
    void database.close().finally(() => { process.exitCode = 1; });
  }, 10_000).unref();
  server.close((error) => {
    clearTimeout(forceTimer);
    if (error) console.error(JSON.stringify({ event: "http_server_close_error", name: error.name }));
    void database.close().then(() => {
      console.log(JSON.stringify({ event: "shutdown_complete" }));
      process.exitCode = error ? 1 : 0;
    }).catch((closeError: unknown) => {
      console.error(JSON.stringify({ event: "database_close_error", name: closeError instanceof Error ? closeError.name : "UnknownError" }));
      process.exitCode = 1;
    });
  });
});
