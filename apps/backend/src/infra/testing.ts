import { MongoClient } from "mongodb";
import type { AppConfig } from "../config/env.js";
import { connectDatabase } from "./database.js";
import { applyMigrations } from "./migrations.js";

export function assertTestDatabase(name: string, nodeEnv: string): void {
  if (nodeEnv !== "test" || !/^hotel_[a-z0-9_]*test$/.test(name) || name === "hotel_prod" || name === "hotel_dev") {
    throw new Error(`Unsafe test database target: ${name} (NODE_ENV=${nodeEnv}); use NODE_ENV=test and a hotel_*_test database.`);
  }
}
export async function createIsolatedTestDatabase(config: AppConfig, suffix: string): Promise<Awaited<ReturnType<typeof connectDatabase>>> {
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  const name = `hotel_${safeSuffix || "suite"}_test`;
  assertTestDatabase(name, config.NODE_ENV);
  const database = await connectDatabase({ ...config, MONGODB_DATABASE: name });
  await applyMigrations(database.db);
  return database;
}

/** Drop only an exact isolated test database; intended for explicit test teardown, never dev/prod cleanup. */
export async function dropIsolatedTestDatabase(config: Pick<AppConfig, "NODE_ENV" | "MONGODB_URI" | "MONGODB_DATABASE">): Promise<void> {
  assertTestDatabase(config.MONGODB_DATABASE, config.NODE_ENV);
  const client = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
  try { await client.connect(); await client.db(config.MONGODB_DATABASE).dropDatabase(); }
  finally { await client.close(); }
}
