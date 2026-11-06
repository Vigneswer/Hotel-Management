import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../../config/env.js";
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from "../../infra/testing.js";
import type { Database } from "../../infra/database.js";
import { RoomCommandService } from "../rooms/commands/service.js";
import { CommandError, ReservationCommandService } from "./commands.js";

const runReplicaSetTests = process.env.NODE_ENV === "test" && process.env.RUN_REPLICA_SET_TESTS === "1" && Boolean(process.env.MONGODB_URI);
let config: AppConfig | undefined;
let database: Database | undefined;
let reservations: ReservationCommandService;
let rooms: RoomCommandService;
const staff = { userId: new ObjectId().toHexString(), role: "STAFF" as const };
const guest = { userId: new ObjectId().toHexString(), role: "GUEST" as const };
const fixedNow = () => new Date("2026-11-04T06:00:00.000Z");

describe.skipIf(!runReplicaSetTests)("reservation commands on an isolated MongoDB replica set", () => {
  beforeAll(async () => {
    config = loadConfig();
    database = await createIsolatedTestDatabase(config, `reservation_commands_${randomUUID()}`);
    reservations = new ReservationCommandService(database, { HOTEL_TIME_ZONE: config.HOTEL_TIME_ZONE, HOTEL_CURRENCY: config.HOTEL_CURRENCY, clock: fixedNow });
    rooms = new RoomCommandService(database, { HOTEL_TIME_ZONE: config.HOTEL_TIME_ZONE, HOTEL_CURRENCY: config.HOTEL_CURRENCY, clock: fixedNow });
  }, 20_000);

  afterAll(async () => {
    if (!config || !database) return;
    const isolated = { ...config, MONGODB_DATABASE: database.db.databaseName };
    await database.close();
    await dropIsolatedTestDatabase(isolated);
  }, 20_000);

  it("allows pending requests to compete but serializes final-room confirmation and replays one key", async () => {
    const room = await createRoom(1);
    const createKey = randomUUID();
    const input = { roomTypeId: room.id, checkInDate: "2026-11-05", checkOutDate: "2026-11-07", guestCount: 2, quoteVersion: room.version };
    const pendingOne = await reservations.createPending({ ...input, actor: guest, operationKey: createKey, requestId: randomUUID() });
    const replay = await reservations.createPending({ ...input, actor: guest, operationKey: createKey, requestId: randomUUID() });
    expect(replay.id).toBe(pendingOne.id);
    const pendingTwo = await reservations.createPending({ ...input, actor: guest, operationKey: randomUUID(), requestId: randomUUID() });

    const operationOne = { actor: staff, operationKey: randomUUID(), requestId: randomUUID(), reservationId: pendingOne.id, expectedVersion: pendingOne.version };
    const operationTwo = { actor: staff, operationKey: randomUUID(), requestId: randomUUID(), reservationId: pendingTwo.id, expectedVersion: pendingTwo.version };
    const outcomes = await Promise.allSettled([reservations.confirm(operationOne), reservations.confirm(operationTwo)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const committed = await database!.collections.reservations.countDocuments({ roomTypeId: new ObjectId(room.id), status: "CONFIRMED" });
    expect(committed).toBe(1);

    const winnerInput = outcomes[0]?.status === "fulfilled" ? operationOne : operationTwo;
    const replayedConfirmation = await reservations.confirm(winnerInput);
    expect(replayedConfirmation.status).toBe("CONFIRMED");
    await expect(reservations.confirm({ ...winnerInput, expectedVersion: 99 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const auditCount = await database!.collections.auditEvents.countDocuments({ entityType: "RESERVATION", action: "CONFIRM" });
    expect(auditCount).toBe(1);
  });

  it("keeps inventory reduction consistent when it races a final-room confirmation", async () => {
    const room = await createRoom(1);
    const pending = await reservations.createPending({
      actor: guest, operationKey: randomUUID(), requestId: randomUUID(), roomTypeId: room.id,
      checkInDate: "2026-11-05", checkOutDate: "2026-11-06", guestCount: 1, quoteVersion: room.version,
    });
    const confirmation = reservations.confirm({ actor: staff, operationKey: randomUUID(), requestId: randomUUID(), reservationId: pending.id, expectedVersion: pending.version });
    const reduction = rooms.update({
      actor: staff, operationKey: randomUUID(), requestId: randomUUID(), roomTypeId: room.id, expectedVersion: room.version,
      patch: { totalInventory: 0, expectedVersion: room.version },
    });
    const [confirmResult, reduceResult] = await Promise.allSettled([confirmation, reduction]);
    expect([confirmResult.status, reduceResult.status]).toContain("rejected");
    const finalRoom = await database!.collections.roomTypes.findOne({ _id: new ObjectId(room.id) });
    const committed = await database!.collections.reservations.countDocuments({ roomTypeId: new ObjectId(room.id), status: { $in: ["CONFIRMED", "CHECKED_IN"] } });
    expect(finalRoom).not.toBeNull();
    expect(finalRoom!.totalInventory).toBeGreaterThanOrEqual(committed);
    if (confirmResult.status === "rejected") expect(confirmResult.reason).toBeInstanceOf(CommandError);
    if (reduceResult.status === "rejected") expect(reduceResult.reason).toBeInstanceOf(CommandError);
  });

  async function createRoom(totalInventory: number) {
    return rooms.create({
      actor: staff, operationKey: randomUUID(), requestId: randomUUID(),
      roomType: { name: `Test ${randomUUID().slice(0, 8)}`, description: "Isolated integration fixture", capacity: 2, facilities: [], nightlyPrice: { amountMinor: 15_000, currency: config!.HOTEL_CURRENCY }, totalInventory },
    });
  }
});

