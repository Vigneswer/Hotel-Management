import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "../../apps/backend/node_modules/express/index.js";
import type { RequestHandler } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/backend/src/app.js";
import { createReservationRoutes, createStaffReservationRoutes } from "../../apps/backend/src/modules/reservations/routes.js";
import type { ReservationCommandService } from "../../apps/backend/src/modules/reservations/commands.js";
import type { ReservationQueryService } from "../../apps/backend/src/modules/reservations/queries.js";

const guestA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const guestB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const reservationId = "cccccccccccccccccccccccc";
const roomTypeId = "dddddddddddddddddddddddd";
const reservation = {
  id: reservationId, guestId: guestA, roomTypeId, guestCount: 2, roomCount: 1 as const,
  checkInDate: "2026-11-05", checkOutDate: "2026-11-07", status: "PENDING" as const,
  priceSnapshot: { amountMinor: 15000, currency: "INR" }, nights: 2,
  total: { amountMinor: 30000, currency: "INR" }, version: 0,
  createdAt: "2026-11-04T06:00:00.000Z", updatedAt: "2026-11-04T06:00:00.000Z",
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe("reservation HTTP boundaries (in-process services; not Mongo guarantees)", () => {
  it("filters reservation detail by authenticated owner and returns 404 for another guest", async () => {
    const query = {
      getById: async (_id: string, actor: { userId: string; role: "GUEST" | "STAFF" }) =>
        actor.role === "STAFF" || actor.userId === reservation.guestId ? reservation : null,
      listMine: async (ownerId: string) => ({ data: ownerId === guestA ? [reservation] : [], pagination: { page: 1, limit: 20, total: ownerId === guestA ? 1 : 0, totalPages: ownerId === guestA ? 1 : 0 } }),
    };
    const { baseUrl } = await startApp({ queries: query });
    const hidden = await fetch(`${baseUrl}/api/v1/reservations/${reservationId}`, { headers: { "x-test-user": guestB } });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

    const own = await fetch(`${baseUrl}/api/v1/reservations/${reservationId}`, { headers: { "x-test-user": guestA } });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ data: { id: reservationId, guestId: guestA } });
  });

  it("rejects caller-supplied owner, role, status, and price fields before command execution", async () => {
    let commandCalls = 0;
    const commands = { createPending: async () => { commandCalls += 1; return reservation; } };
    const { baseUrl } = await startApp({ commands });
    const response = await fetch(`${baseUrl}/api/v1/reservations`, {
      method: "POST", headers: { "content-type": "application/json", "x-test-user": guestB, "idempotency-key": "3e1ba4f4-5d4c-4c4a-b20c-3a63f21fb46c" },
      body: JSON.stringify({ roomTypeId, checkInDate: "2026-11-05", checkOutDate: "2026-11-07", guestCount: 2, quoteVersion: 0, guestId: guestA, role: "STAFF", status: "CONFIRMED", total: { amountMinor: 1, currency: "INR" } }),
    });
    expect(response.status).toBe(400);
    expect(commandCalls).toBe(0);
  });

  it("forwards validated database page and status parameters to the guest query", async () => {
    let received: unknown;
    const query = { listMine: async (_ownerId: string, input: unknown) => {
      received = input;
      return { data: [], pagination: { page: 2, limit: 3, total: 5, totalPages: 2 } };
    } };
    const { baseUrl } = await startApp({ queries: query });
    const response = await fetch(`${baseUrl}/api/v1/reservations/me?page=2&limit=3&status=PENDING`, { headers: { "x-test-user": guestA } });
    expect(response.status).toBe(200);
    expect(received).toEqual({ page: 2, limit: 3, status: "PENDING" });
    expect(await response.json()).toMatchObject({ pagination: { page: 2, limit: 3, total: 5 } });

    const invalid = await fetch(`${baseUrl}/api/v1/reservations/me?page=0&limit=101`, { headers: { "x-test-user": guestA } });
    expect(invalid.status).toBe(400);
  });

  it("requires staff middleware for staff reservation routes and mounts at the composed prefix", async () => {
    const { baseUrl } = await startApp({ queries: { listStaff: async () => ({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }) } });
    const guestResponse = await fetch(`${baseUrl}/api/v1/staff/reservations`, { headers: { "x-test-user": guestA } });
    expect(guestResponse.status).toBe(403);
    const staffResponse = await fetch(`${baseUrl}/api/v1/staff/reservations`, { headers: { "x-test-user": guestA, "x-test-role": "STAFF" } });
    expect(staffResponse.status).toBe(200);
  });
});

async function startApp(input: { commands?: object; queries?: object }): Promise<{ baseUrl: string }> {
  const identify: RequestHandler = (req, _res, next) => {
    const userId = req.get("x-test-user") ?? guestA;
    const role = req.get("x-test-role") === "STAFF" ? "STAFF" : "GUEST";
    Object.assign(req, { auth: { actor: { userId, role }, sessionId: "test-session" } });
    next();
  };
  const requireStaff: RequestHandler = (req, res, next) => req.auth?.actor.role === "STAFF" ? next() : res.status(403).json({ error: { code: "FORBIDDEN", message: "Staff only.", details: {} }, requestId: res.locals.requestId });
  const pass: RequestHandler = (_req, _res, next) => next();
  const deps = { commands: (input.commands ?? {}) as ReservationCommandService, queries: (input.queries ?? {}) as ReservationQueryService, requireActor: identify, requireStaff, verifyCsrf: pass };
  const staff = Router();
  staff.use("/reservations", createStaffReservationRoutes(deps));
  const app = createApp({ routes: { reservations: createReservationRoutes(deps), staff } });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
