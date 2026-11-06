import "../src/config/load-env.js";
import { z } from "zod";
import { connectDatabase } from "../src/infra/database.js";

const WaitConfig = z.object({
  MONGODB_URI: z.string().default("mongodb://localhost:27017/hotel_dev?replicaSet=rs0"),
  MONGODB_DATABASE: z.string().default("hotel_dev"),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(500).default(20),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  MONGODB_WAIT_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(3_000),
});
const config = WaitConfig.parse(process.env);
const deadline = Date.now() + 90_000;
let attempts = 0;
while (Date.now() < deadline) {
  attempts += 1;
  try {
    const database = await connectDatabase(config);
    await database.close();
    console.log(JSON.stringify({ event: "database_ready", database: config.MONGODB_DATABASE, attempts }));
    process.exitCode = 0;
    break;
  } catch {
    if (Date.now() >= deadline) {
      console.error(JSON.stringify({ event: "database_not_ready", database: config.MONGODB_DATABASE, attempts, timeoutMs: 90_000 }));
      process.exitCode = 1;
      break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  }
}
