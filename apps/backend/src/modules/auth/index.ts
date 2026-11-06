import type { Database } from "../../infra/database.js";
import type { AppConfig } from "../../config/env.js";
import { createMongoAuthStore } from "./mongo-store.js";
import { createAuthMiddleware } from "./middleware.js";
import { argon2PasswordHasher } from "./password.js";
import { createAuthRoutes } from "./routes.js";
import { AuthService } from "./service.js";
import type { AuthConfig } from "./types.js";

export { AuthError, AuthService, hashOpaqueToken, normalizeEmail } from "./service.js";
export { createAuthMiddleware, readCookie, signCsrf } from "./middleware.js";
export { createAuthRoutes } from "./routes.js";
export { argon2PasswordHasher } from "./password.js";
export { createMongoAuthStore } from "./mongo-store.js";
export type { AuthConfig, AuthStore, CurrentIdentity, PasswordHasher, SessionRecord, UserRecord } from "./types.js";

export function authConfigFromApp(config: AppConfig): AuthConfig {
  return {
    sessionCookieName: "hotel_session", csrfCookieName: "hotel_csrf",
    sessionTtlHours: config.SESSION_TTL_HOURS, sessionCookieSecure: config.SESSION_COOKIE_SECURE,
    webOrigin: new URL(config.WEB_ORIGIN).origin, apiOrigin: new URL(config.API_ORIGIN).origin,
    csrfSecret: config.CSRF_SECRET,
  };
}

/** Ready-to-mount authentication route handler using L1's typed Mongo collections. */
export function createAuthModule(database: Database, config: AuthConfig): { readonly routes: ReturnType<typeof createAuthRoutes>; readonly service: AuthService; readonly middleware: ReturnType<typeof createAuthMiddleware> } {
  const service = new AuthService(createMongoAuthStore(database), argon2PasswordHasher, config);
  const middleware = createAuthMiddleware(service, config);
  return { routes: createAuthRoutes({ service, config, middleware }), service, middleware };
}
