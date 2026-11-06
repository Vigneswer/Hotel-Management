import "../src/config/load-env.js";
import argon2 from "argon2";
import { ObjectId } from "mongodb";
import { loadConfig } from "../src/config/env.js";
import { connectDatabase } from "../src/infra/database.js";
import { applyMigrations } from "../src/infra/migrations.js";

const config = loadConfig();
if (config.NODE_ENV === "production" || !/^hotel_(dev|demo|[a-z0-9_]+_demo)$/.test(config.MONGODB_DATABASE)) throw new Error(`Refusing to seed non-demo database: ${config.MONGODB_DATABASE}`);
const credentials = {
  guestEmail: process.env.DEMO_GUEST_EMAIL?.trim().toLowerCase(), guestPassword: process.env.DEMO_GUEST_PASSWORD,
  staffEmail: process.env.DEMO_STAFF_EMAIL?.trim().toLowerCase(), staffPassword: process.env.DEMO_STAFF_PASSWORD,
};
if (!credentials.guestEmail || !credentials.guestPassword || !credentials.staffEmail || !credentials.staffPassword) throw new Error("Set all four DEMO_GUEST_* and DEMO_STAFF_* values in your untracked .env before seeding.");
if (credentials.guestEmail === credentials.staffEmail) throw new Error("Guest and staff demo emails must differ.");

function hotelToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: config.HOTEL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = value("year"), month = value("month"), day = value("day");
  if (!year || !month || !day) throw new Error("Could not determine hotel calendar date.");
  return `${year}-${month}-${day}`;
}
function shiftDay(date: string, amount: number): string { const shifted = new Date(`${date}T00:00:00.000Z`); shifted.setUTCDate(shifted.getUTCDate() + amount); return shifted.toISOString().slice(0, 10); }
function makeStay(startOffset: number, nights: number): { checkInDate: string; checkOutDate: string } { const start = shiftDay(hotelToday(), startOffset); return { checkInDate: start, checkOutDate: shiftDay(start, nights) }; }

const database = await connectDatabase(config);
try {
  await applyMigrations(database.db);
  const now = new Date();
  const upsertUser = async (name: string, emailNormalized: string, password: string, role: "GUEST" | "STAFF"): Promise<ObjectId> => {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await database.collections.users.updateOne({ emailNormalized }, { $set: { name, passwordHash, role, active: true, updatedAt: now }, $setOnInsert: { _id: new ObjectId(), emailNormalized, createdAt: now } }, { upsert: true });
    const user = await database.collections.users.findOne({ emailNormalized }, { projection: { _id: 1 } });
    if (!user) throw new Error("Failed to seed demo identity.");
    return user._id;
  };
  const guestId = await upsertUser("Demo Guest", credentials.guestEmail, credentials.guestPassword, "GUEST");
  await upsertUser("Demo Staff", credentials.staffEmail, credentials.staffPassword, "STAFF");
  const roomSeeds = [
    { name: "Standard Room", description: "Comfortable room for up to two guests.", capacity: 2, facilities: ["Wi-Fi", "Air conditioning"], nightlyPriceMinor: 450000, totalInventory: 8 },
    { name: "Family Suite", description: "Spacious suite for a family stay.", capacity: 4, facilities: ["Wi-Fi", "Air conditioning", "Breakfast area"], nightlyPriceMinor: 820000, totalInventory: 3 },
  ];
  const roomIds = new Map<string, ObjectId>();
  for (const room of roomSeeds) {
    await database.collections.roomTypes.updateOne({ name: room.name }, { $set: { ...room, currency: config.HOTEL_CURRENCY, active: true, inventoryVersion: 0, version: 0, updatedAt: now }, $setOnInsert: { _id: new ObjectId(), createdAt: now } }, { upsert: true });
    const roomDoc = await database.collections.roomTypes.findOne({ name: room.name }, { projection: { _id: 1 } });
    if (!roomDoc) throw new Error(`Failed to seed room type ${room.name}`);
    roomIds.set(room.name, roomDoc._id);
  }
  const reservationSeeds = [
    { reference: "DEMO-PENDING-01", room: "Standard Room", status: "PENDING" as const, stay: makeStay(8, 2), guestCount: 1 },
    { reference: "DEMO-CONFIRM-01", room: "Standard Room", status: "CONFIRMED" as const, stay: makeStay(12, 3), guestCount: 2 },
    { reference: "DEMO-CANCEL-01", room: "Family Suite", status: "CANCELLED" as const, stay: makeStay(16, 2), guestCount: 3 },
    { reference: "DEMO-INHOUSE-01", room: "Standard Room", status: "CHECKED_IN" as const, stay: makeStay(-1, 2), guestCount: 2 },
    { reference: "DEMO-CLOSED-01", room: "Family Suite", status: "CHECKED_OUT" as const, stay: makeStay(-6, 3), guestCount: 4 },
  ];
  for (const item of reservationSeeds) {
    const roomTypeId = roomIds.get(item.room);
    if (!roomTypeId) throw new Error(`Missing seeded room ${item.room}`);
    const roomType = await database.collections.roomTypes.findOne({ _id: roomTypeId });
    if (!roomType) throw new Error(`Missing seeded room document ${item.room}`);
    const nights = (Date.parse(`${item.stay.checkOutDate}T00:00:00Z`) - Date.parse(`${item.stay.checkInDate}T00:00:00Z`)) / 86_400_000;
    const reservation = { _id: new ObjectId(), reference: item.reference, guestId, roomTypeId, roomTypeNameSnapshot: roomType.name, ...item.stay, guestCount: item.guestCount, roomCount: 1, nightCount: nights, nightlyPriceMinor: roomType.nightlyPriceMinor, currency: roomType.currency, totalMinor: roomType.nightlyPriceMinor * nights, status: item.status, version: 0, createdAt: now, updatedAt: now };
    await database.collections.reservations.updateOne({ reference: item.reference }, { $setOnInsert: reservation }, { upsert: true });
  }
  console.log(JSON.stringify({ event: "development_seed_complete", database: config.MONGODB_DATABASE, guestEmail: credentials.guestEmail, staffEmail: credentials.staffEmail, reservations: reservationSeeds.length, credentials: "passwords supplied only through local environment; rotate before any shared demo" }));
} finally { await database.close(); }
