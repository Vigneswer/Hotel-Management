import { createHash, randomBytes } from "node:crypto";
import type { UserDto } from "@hotel/contracts";
import type { AuthConfig, AuthStore, CurrentIdentity, PasswordHasher, SessionRecord, UserRecord } from "./types.js";
import { toActor, toUserDto } from "./types.js";

export class AuthError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 409, message: string) { super(message); }
}

export interface IssuedSession { readonly token: string; readonly expiresAt: Date; readonly user: UserDto; readonly session: CurrentIdentity }

export class AuthService {
  private readonly dummyHash: Promise<string>;

  constructor(private readonly store: AuthStore, private readonly passwords: PasswordHasher, private readonly config: AuthConfig, private readonly now: () => Date = () => new Date()) {
    // Keep unknown-email login work close to the Argon2 cost of a real password check.
    this.dummyHash = passwords.hash(randomBytes(32).toString("hex"));
  }

  async register(input: { name: string; email: string; password: string }): Promise<IssuedSession> {
    const emailNormalized = normalizeEmail(input.email);
    if (await this.store.findUserByNormalizedEmail(emailNormalized)) throw new AuthError(409, "An account with this email already exists.");
    const now = this.now();
    let user: UserRecord;
    try {
      user = await this.store.insertUser({
        name: input.name.trim(), email: input.email.trim(), emailNormalized,
        passwordHash: await this.passwords.hash(input.password), role: "GUEST", active: true, createdAt: now, updatedAt: now,
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new AuthError(409, "An account with this email already exists.");
      throw error;
    }
    return this.issue(user);
  }

  async login(input: { email: string; password: string }): Promise<IssuedSession> {
    const user = await this.store.findUserByNormalizedEmail(normalizeEmail(input.email));
    const hash = user?.passwordHash ?? await this.dummyHash;
    const passwordMatches = await this.passwords.verify(hash, input.password);
    const valid = Boolean(user && passwordMatches);
    if (!user || !valid || !user.active) throw new AuthError(401, "Email or password is incorrect.");
    return this.issue(user);
  }

  async current(token: string | undefined): Promise<CurrentIdentity | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const tokenHash = hashOpaqueToken(token);
    const session = await this.store.findSessionByTokenHash(tokenHash);
    if (!session) return null;
    if (session.expiresAt.getTime() <= this.now().getTime()) {
      await this.store.deleteSession(session.id);
      return null;
    }
    const user = await this.store.findUserById(session.userId);
    if (!user || !user.active) {
      await this.store.deleteSession(session.id);
      return null;
    }
    return identity(user, session);
  }

  async logout(sessionId: string): Promise<void> { await this.store.deleteSession(sessionId); }

  private async issue(user: UserRecord): Promise<IssuedSession> {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlHours * 60 * 60 * 1000);
    const session = await this.store.insertSession({ tokenHash: hashOpaqueToken(token), userId: user.id, createdAt: now, expiresAt });
    const current = identity(user, session);
    return { token, expiresAt, user: toUserDto(user), session: current };
  }
}

export function normalizeEmail(email: string): string { return email.trim().normalize("NFKC").toLocaleLowerCase("en-US"); }
export function hashOpaqueToken(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }
function identity(user: UserRecord, session: SessionRecord): CurrentIdentity { return { actor: toActor(user), sessionId: session.id, user: toUserDto(user) }; }
function isDuplicateKey(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === 11000; }
