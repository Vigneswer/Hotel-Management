import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { AuthConfig, CurrentIdentity } from "./types.js";
import { AuthService } from "./service.js";

declare global { namespace Express { interface Request { auth?: CurrentIdentity; } } }

export function createAuthMiddleware(service: AuthService, config: AuthConfig): {
  requireActor: RequestHandler;
  requireStaff: RequestHandler;
  verifyCsrf: RequestHandler;
  issueCsrfBootstrap: RequestHandler;
} {
  const requireActor: RequestHandler = async (req, res, next) => {
    try {
      const identity = await service.current(readCookie(req, config.sessionCookieName));
      if (!identity) { res.status(401).json(apiError(res, "UNAUTHENTICATED", "Sign in to continue.")); return; }
      req.auth = identity;
      next();
    } catch (error) { next(error); }
  };
  const requireStaff: RequestHandler = (req, res, next) => {
    if (!req.auth) { res.status(401).json(apiError(res, "UNAUTHENTICATED", "Sign in to continue.")); return; }
    if (req.auth.actor.role !== "STAFF") { res.status(403).json(apiError(res, "FORBIDDEN", "Staff access is required.")); return; }
    next();
  };
  const issueCsrfBootstrap: RequestHandler = async (req, res, next) => {
    try {
      const identity = await service.current(readCookie(req, config.sessionCookieName));
      if (identity) req.auth = identity;
      const nonce = randomBytes(24).toString("base64url");
      res.cookie(config.csrfCookieName, nonce, { httpOnly: true, secure: config.sessionCookieSecure, sameSite: "lax", path: "/api/v1", maxAge: 10 * 60 * 1000 });
      const binding = identity?.sessionId ?? "anonymous";
      res.json({ csrfToken: signCsrf(config.csrfSecret, nonce, binding), requestId: res.locals.requestId });
    } catch (error) { next(error); }
  };
  const verifyCsrf: RequestHandler = async (req, res, next) => {
    try {
      const origin = req.get("origin");
      if (!origin || (origin !== config.webOrigin && origin !== config.apiOrigin)) {
        res.status(403).json(apiError(res, "FORBIDDEN", "Request origin is not allowed.")); return;
      }
      const identity = req.auth ?? await service.current(readCookie(req, config.sessionCookieName));
      if (identity) req.auth = identity;
      const nonce = readCookie(req, config.csrfCookieName);
      const token = req.get("x-csrf-token");
      const binding = identity?.sessionId ?? "anonymous";
      if (!nonce || !token || !constantTimeEqual(token, signCsrf(config.csrfSecret, nonce, binding))) {
        res.status(403).json(apiError(res, "FORBIDDEN", "CSRF validation failed.")); return;
      }
      next();
    } catch (error) { next(error); }
  };
  return { requireActor, requireStaff, verifyCsrf, issueCsrfBootstrap };
}

export function signCsrf(secret: string, nonce: string, binding: string): string {
  return createHmac("sha256", secret).update(`${nonce}.${binding}`, "utf8").digest("base64url");
}

export function readCookie(req: Request, cookieName: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function apiError(res: Response, code: string, message: string): object {
  return { error: { code, message, details: {} }, requestId: res.locals.requestId };
}
