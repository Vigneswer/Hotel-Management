import "../src/config/load-env.js";
import { ObjectId } from "mongodb";
import { loadConfig } from "../src/config/env.js";
import { connectDatabase } from "../src/infra/database.js";
import { applyMigrations } from "../src/infra/migrations.js";
import { assertTestDatabase } from "../src/infra/testing.js";

const config = loadConfig();
assertTestDatabase(config.MONGODB_DATABASE, config.NODE_ENV);
if (config.MONGODB_DATABASE !== "hotel_test") throw new Error("Reset script only permits the dedicated hotel_test database.");
const database = await connectDatabase(config);
try {
  await database.db.dropDatabase();
  await applyMigrations(database.db);
  const now = new Date();
  const _id = new ObjectId();
  const testUser = { _id, name: "Index verification", emailNormalized: `index-${_id.toHexString()}@example.test`, passwordHash: "test-only-not-a-login-hash", role: "GUEST" as const, active: true, createdAt: now, updatedAt: now };
  await database.collections.users.insertOne(testUser);
  let duplicateRejected = false;
  try { await database.collections.users.insertOne({ ...testUser, _id: new ObjectId() }); }
  catch (error) { duplicateRejected = typeof error === "object" && error !== null && "code" in error && error.code === 11000; }
  if (!duplicateRejected) throw new Error("Unique normalized-email index did not reject a duplicate.");
  await database.collections.users.deleteOne({ _id });
  console.log(JSON.stringify({ event: "test_database_reset", database: config.MONGODB_DATABASE, uniqueEmailIndex: "verified" }));
} finally { await database.close(); }
