import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header("x-request-id");
  const id = supplied && /^[\w.-]{1,100}$/.test(supplied) ? supplied : randomUUID();
  res.locals.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const requestIdValue = typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
    const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : "unmatched";
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info(JSON.stringify({
      event: "http_request", requestId: requestIdValue, method: req.method, route,
      status: res.statusCode, durationMs: Math.round(durationMs * 100) / 100,
      ...(req.auth?.actor.userId ? { actorId: req.auth.actor.userId } : {}),
    }));
  });
  next();
}
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const requestIdValue = typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
  const safe = status < 500 ? (error instanceof Error ? error.message : "Request failed") : "An unexpected error occurred.";
  if (status >= 500) console.error(JSON.stringify({ event: "request_error", requestId: requestIdValue, status, errorName: error instanceof Error ? error.name : "UnknownError" }));
  res.status(status).json({ error: { code: status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR", message: safe, details: {} }, requestId: requestIdValue });
}
