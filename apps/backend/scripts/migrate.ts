import "../src/config/load-env.js";
import { loadConfig } from "../src/config/env.js";
import { connectDatabase } from "../src/infra/database.js";
import { applyMigrations } from "../src/infra/migrations.js";

const config = loadConfig();
if (!/^hotel_[a-z0-9_]+$/.test(config.MONGODB_DATABASE) || ["hotel_test", "hotel_prod"].includes(config.MONGODB_DATABASE) && config.NODE_ENV !== (config.MONGODB_DATABASE === "hotel_prod" ? "production" : "test")) {
  throw new Error(`Refusing migration for unexpected database/environment pair: ${config.MONGODB_DATABASE} / ${config.NODE_ENV}`);
}
const database = await connectDatabase(config);
try {
  const result = await applyMigrations(database.db);
  console.log(JSON.stringify({ event: "database_migrations_applied", database: config.MONGODB_DATABASE, applied: result.applied }));
} finally { await database.close(); }
