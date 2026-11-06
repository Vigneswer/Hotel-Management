import { describe, expect, it } from "vitest";
import type { SessionRecord, UserRecord } from "./types.js";
import type { AuthStore, AuthConfig, PasswordHasher } from "./types.js";
import { AuthService, hashOpaqueToken, normalizeEmail } from "./service.js";
import { signCsrf } from "./middleware.js";

const config: AuthConfig = {
  sessionCookieName: "hotel_session", csrfCookieName: "hotel_csrf", sessionTtlHours: 24,
  sessionCookieSecure: false, webOrigin: "http://localhost:5173", apiOrigin: "http://localhost:3001", csrfSecret: "a".repeat(32),
};
const hasher: PasswordHasher = { hash: async (password) => `argon:${password}`, verify: async (hash, password) => hash === `argon:${password}` };

class MemoryStore implements AuthStore {
  readonly users: UserRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  private nextId = 1;
  async findUserByNormalizedEmail(email: string): Promise<UserRecord | null> { return this.users.find((user) => user.emailNormalized === email) ?? null; }
  async findUserById(id: string): Promise<UserRecord | null> { return this.users.find((user) => user.id === id) ?? null; }
  async insertUser(input: Omit<UserRecord, "id">): Promise<UserRecord> { const user = { ...input, id: String(this.nextId++) }; this.users.push(user); return user; }
  async insertSession(input: Omit<SessionRecord, "id">): Promise<SessionRecord> { const session = { ...input, id: String(this.nextId++) }; this.sessions.push(session); return session; }
  async findSessionByTokenHash(hash: string): Promise<SessionRecord | null> { return this.sessions.find((session) => session.tokenHash === hash) ?? null; }
  async deleteSession(id: string): Promise<void> { const index = this.sessions.findIndex((session) => session.id === id); if (index >= 0) this.sessions.splice(index, 1); }
}

describe("AuthService", () => {
  it("always registers a guest and stores only a digest of a random opaque session", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store, hasher, config, () => new Date("2026-11-04T00:00:00Z"));
    const issued = await service.register({ name: "Guest", email: "Guest@Example.com", password: "long-password" });

    expect(issued.user.role).toBe("GUEST");
    expect(issued.user).not.toHaveProperty("passwordHash");
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.sessions[0]?.tokenHash).toBe(hashOpaqueToken(issued.token));
    expect(store.sessions[0]?.tokenHash).not.toBe(issued.token);
    expect(issued.expiresAt.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("authenticates by normalized email and rejects expired, revoked and inactive sessions", async () => {
    const store = new MemoryStore();
    let now = new Date("2026-11-04T00:00:00Z");
    const service = new AuthService(store, hasher, config, () => now);
    const issued = await service.register({ name: "Guest", email: "Guest@Example.com", password: "long-password" });
    expect((await service.login({ email: " guest@example.COM ", password: "long-password" })).user.id).toBe(issued.user.id);
    expect(await service.current(issued.token)).not.toBeNull();

    now = new Date("2026-11-05T00:00:00Z");
    expect(await service.current(issued.token)).toBeNull();
    expect(store.sessions.some((session) => session.tokenHash === hashOpaqueToken(issued.token))).toBe(false);
  });

  it("does not disclose unknown email and password failures and applies NFKC case folding", async () => {
    const service = new AuthService(new MemoryStore(), hasher, config);
    await expect(service.login({ email: "nobody@example.com", password: "wrong" })).rejects.toMatchObject({ status: 401 });
    expect(normalizeEmail("  Ｇuest@Example.com  ")).toBe("guest@example.com");
  });

  it("reloads the current role and revokes a session on logout or user deactivation", async () => {
    const store = new MemoryStore();
    const service = new AuthService(store, hasher, config);
    const issued = await service.register({ name: "Guest", email: "guest@example.com", password: "long-password" });
    const user = store.users[0];
    if (!user) throw new Error("Test user was not inserted.");
    const staffUser = { ...user, role: "STAFF" as const };
    store.users[0] = staffUser;
    expect((await service.current(issued.token))?.actor.role).toBe("STAFF");
    store.users[0] = { ...staffUser, active: false };
    expect(await service.current(issued.token)).toBeNull();
    await service.logout(issued.session.sessionId);
    expect(await service.current(issued.token)).toBeNull();
  });

  it("binds CSRF proofs to both the bootstrap nonce and session", () => {
    const token = signCsrf(config.csrfSecret, "nonce", "session-1");
    expect(signCsrf(config.csrfSecret, "nonce", "session-1")).toBe(token);
    expect(signCsrf(config.csrfSecret, "another-nonce", "session-1")).not.toBe(token);
    expect(signCsrf(config.csrfSecret, "nonce", "session-2")).not.toBe(token);
  });
});
