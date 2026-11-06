import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { AuthConfig } from "./types.js";
import { AuthError, AuthService } from "./service.js";
import { createAuthMiddleware } from "./middleware.js";

const RegisterSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254), password: z.string().min(12).max(128) }).strict();
const LoginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict();

export interface AuthRouteDependencies { readonly service: AuthService; readonly config: AuthConfig; readonly middleware?: ReturnType<typeof createAuthMiddleware>; }

export function createAuthRoutes(deps: AuthRouteDependencies): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("cache-control", "no-store"); next(); });
  const middleware = deps.middleware ?? createAuthMiddleware(deps.service, deps.config);
  router.get("/csrf", middleware.issueCsrfBootstrap);
  router.post("/register", middleware.verifyCsrf, asyncHandler(async (req, res) => {
    const input = RegisterSchema.parse(req.body);
    const issued = await deps.service.register(input);
    setSessionCookie(res, issued.token, issued.expiresAt, deps.config);
    res.status(201).json({ data: { user: issued.user }, requestId: res.locals.requestId });
  }));
  router.post("/login", middleware.verifyCsrf, asyncHandler(async (req, res) => {
    const input = LoginSchema.parse(req.body);
    const issued = await deps.service.login(input);
    setSessionCookie(res, issued.token, issued.expiresAt, deps.config);
    res.json({ data: { user: issued.user }, requestId: res.locals.requestId });
  }));
  router.get("/me", middleware.requireActor, (req, res) => res.json({ data: req.auth?.user, requestId: res.locals.requestId }));
  router.post("/logout", middleware.requireActor, middleware.verifyCsrf, asyncHandler(async (req, res) => {
    const identity = req.auth;
    if (!identity) throw new AuthError(401, "Sign in to continue.");
    await deps.service.logout(identity.sessionId);
    clearSessionCookie(res, deps.config);
    res.clearCookie(deps.config.csrfCookieName, { httpOnly: true, secure: deps.config.sessionCookieSecure, sameSite: "lax", path: "/api/v1" });
    res.status(204).end();
  }));
  return router;
}

function setSessionCookie(res: import("express").Response, token: string, expiresAt: Date, config: AuthConfig): void {
  res.cookie(config.sessionCookieName, token, { httpOnly: true, secure: config.sessionCookieSecure, sameSite: "lax", path: "/api/v1", expires: expiresAt });
}
function clearSessionCookie(res: import("express").Response, config: AuthConfig): void {
  res.clearCookie(config.sessionCookieName, { httpOnly: true, secure: config.sessionCookieSecure, sameSite: "lax", path: "/api/v1" });
}
function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error: unknown) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed.", details: { issues: error.issues.map(({ path, code }) => ({ path, code })) } }, requestId: res.locals.requestId }); return; }
    if (error instanceof AuthError) { const code = error.status === 401 ? "UNAUTHENTICATED" : error.status === 403 ? "FORBIDDEN" : error.status === 409 ? "STATE_CONFLICT" : "VALIDATION_ERROR"; res.status(error.status).json({ error: { code, message: error.message, details: {} }, requestId: res.locals.requestId }); return; }
    next(error);
  });
}
