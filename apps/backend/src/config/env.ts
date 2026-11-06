import { z } from "zod";

const EnvSchema = z.object({ NODE_ENV: z.enum(["development", "test", "production"]).default("development"), API_PORT: z.coerce.number().int().min(1).max(65535).default(3001), API_ORIGIN: z.string().url().default("http://localhost:3001"), WEB_ORIGIN: z.string().url().default("http://localhost:5173"), MONGODB_URI: z.string().min(1), MONGODB_DATABASE: z.string().min(1), MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(500).default(20), MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000), MONGODB_WAIT_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(3_000), HOTEL_TIME_ZONE: z.string().default("Asia/Kolkata"), HOTEL_CURRENCY: z.string().length(3).default("INR"), SESSION_COOKIE_SECURE: z.coerce.boolean().default(false), SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24), CSRF_SECRET: z.string().min(32) });
const ConfigSchema = EnvSchema.superRefine((config, context) => {
  if (config.NODE_ENV === "production" && !config.SESSION_COOKIE_SECURE) context.addIssue({ code: "custom", path: ["SESSION_COOKIE_SECURE"], message: "Secure session cookies are required in production." });
});
export type AppConfig = z.infer<typeof EnvSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig { return ConfigSchema.parse(env); }
