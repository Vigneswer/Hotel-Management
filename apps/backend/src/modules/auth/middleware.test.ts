import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { createAuthMiddleware, signCsrf } from "./middleware.js";
import { AuthService } from "./service.js";
import type { AuthConfig, AuthStore, PasswordHasher, SessionRecord, UserRecord } from "./types.js";

const config: AuthConfig = {
  sessionCookieName: "hotel_session", csrfCookieName: "hotel_csrf", sessionTtlHours: 1,
  sessionCookieSecure: false, webOrigin: "http://localhost:5173", apiOrigin: "http://localhost:3001", csrfSecret: "b".repeat(32),
};
class MemoryStore implements AuthStore {
  readonly users: UserRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  private counter = 0;
  async findUserByNormalizedEmail(email: string): Promise<UserRecord | null> { return this.users.find((user) => user.emailNormalized === email) ?? null; }
  async findUserById(id: string): Promise<UserRecord | null> { return this.users.find((user) => user.id === id) ?? null; }
  async insertUser(input: Omit<UserRecord, "id">): Promise<UserRecord> { const user = { ...input, id: String(++this.counter) }; this.users.push(user); return user; }
  async insertSession(input: Omit<SessionRecord, "id">): Promise<SessionRecord> { const session = { ...input, id: String(++this.counter) }; this.sessions.push(session); return session; }
  async findSessionByTokenHash(hash: string): Promise<SessionRecord | null> { return this.sessions.find((session) => session.tokenHash === hash) ?? null; }
  async deleteSession(id: string): Promise<void> { const index = this.sessions.findIndex((session) => session.id === id); if (index >= 0) this.sessions.splice(index, 1); }
}

function request(headers: Record<string, string> = {}): Request {
  return {
    headers: { cookie: headers.cookie },
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}
function response(): Response & { statusCode: number; body: unknown; cookieValue?: string } {
  const value = {
    locals: { requestId: "test-request" }, statusCode: 200, body: undefined as unknown, cookieValue: undefined as string | undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    cookie(_name: string, cookieValue: string) { this.cookieValue = cookieValue; return this; },
  };
  return value as unknown as Response & { statusCode: number; body: unknown; cookieValue?: string };
}

describe("authentication middleware", () => {
  it("loads an active actor from the opaque session and rejects a guest at staff boundaries", async () => {
    const store = new MemoryStore();
    const hasher: PasswordHasher = { hash: async (password) => `hash:${password}`, verify: async () => false };
    const service = new AuthService(store, hasher, config);
    const issued = await service.register({ name: "Guest", email: "guest@example.com", password: "long-password" });
    const middleware = createAuthMiddleware(service, config);
    const req = request({ cookie: `${config.sessionCookieName}=${issued.token}` });
    const res = response(); let actorNext = false;
    await middleware.requireActor(req, res, () => { actorNext = true; });
    expect(actorNext).toBe(true);
    expect(req.auth?.actor.role).toBe("GUEST");
    let staffNext = false;
    middleware.requireStaff(req, res, () => { staffNext = true; });
    expect(staffNext).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("rejects CSRF tokens from a foreign origin and accepts a session-bound proof", async () => {
    const service = new AuthService(new MemoryStore(), { hash: async (value) => value, verify: async () => false }, config);
    const middleware = createAuthMiddleware(service, config);
    const nonce = "bootstrap-nonce";
    const token = signCsrf(config.csrfSecret, nonce, "anonymous");
    const goodReq = request({ cookie: `${config.csrfCookieName}=${nonce}`, origin: config.webOrigin, "x-csrf-token": token });
    const goodRes = response(); let accepted = false;
    await middleware.verifyCsrf(goodReq, goodRes, () => { accepted = true; });
    expect(accepted).toBe(true);

    const badReq = request({ cookie: `${config.csrfCookieName}=${nonce}`, origin: "https://attacker.example", "x-csrf-token": token });
    const badRes = response();
    await middleware.verifyCsrf(badReq, badRes, () => { throw new Error("Foreign Origin was accepted."); });
    expect(badRes.statusCode).toBe(403);
  });
});
