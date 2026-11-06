import { ApiErrorSchema, ApiErrorCodeSchema } from "@hotel/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { z } from "zod";

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema> | "UNKNOWN_ERROR";
export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";
  constructor(readonly status: number, readonly code: ApiErrorCode, readonly requestId: string | undefined, message: string, readonly details: Record<string, unknown> = {}, readonly validEnvelope = true) {
    super(message);
  }
}
export class ApiResponseParseError extends Error {
  override readonly name = "ApiResponseParseError";
  constructor(readonly status: number) { super("The server returned an unreadable response."); }
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown; idempotencyKey?: string };
let csrfToken: string | undefined;
export function clearSessionClientState(): void { csrfToken = undefined; }
export function clearAuthenticatedCache(queryClient: QueryClient): void { clearSessionClientState(); queryClient.clear(); }
async function loadCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not initialize request protection.");
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || !("csrfToken" in value) || typeof value.csrfToken !== "string") throw new Error("Invalid CSRF bootstrap response.");
  csrfToken = value.csrfToken;
  return csrfToken;
}
export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRF-Token", await loadCsrf());
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const { body: _body, idempotencyKey: _idempotencyKey, ...fetchOptions } = options;
  const init: RequestInit = { ...fetchOptions, method, headers, credentials: "same-origin" };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  else delete init.body;
  const response = await fetch(path, init);
  if (response.status === 401) clearSessionClientState();
  let payload: unknown;
  if (response.status !== 204) {
    try { payload = await response.json(); }
    catch { if (response.ok) throw new ApiResponseParseError(response.status); }
  }
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    throw new ApiRequestError(
      response.status,
      parsed.success ? parsed.data.error.code : "UNKNOWN_ERROR",
      parsed.success ? parsed.data.requestId : response.headers.get("x-request-id") ?? undefined,
      parsed.success ? parsed.data.error.message : "The request failed.",
      parsed.success ? parsed.data.error.details : {},
      parsed.success,
    );
  }
  if (/\/auth\/(register|login|logout)(?:\?|$)/.test(path)) clearSessionClientState();
  return payload as T;
}
/** Persist this key alongside the pending UI operation and reuse it after timeout/reload. */
export function operationKey(storage: Storage, scope: string): string {
  const key = `hotel.operation.${scope}`;
  const existing = storage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  storage.setItem(key, created);
  return created;
}
export function completeOperation(storage: Storage, scope: string): void { storage.removeItem(`hotel.operation.${scope}`); }
