import type { Actor, AuthenticatedSession, Role, UserDto } from "@hotel/contracts";

export interface UserRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailNormalized: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SessionRecord {
  readonly id: string;
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface AuthStore {
  findUserByNormalizedEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  insertUser(user: Omit<UserRecord, "id">): Promise<UserRecord>;
  insertSession(session: Omit<SessionRecord, "id">): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export interface CurrentIdentity extends AuthenticatedSession {
  readonly user: UserDto;
}

export interface AuthConfig {
  readonly sessionCookieName: string;
  readonly csrfCookieName: string;
  readonly sessionTtlHours: number;
  readonly sessionCookieSecure: boolean;
  readonly webOrigin: string;
  readonly apiOrigin: string;
  readonly csrfSecret: string;
}

export function toUserDto(user: UserRecord): UserDto {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export function toActor(user: UserRecord): Actor {
  return { userId: user.id, role: user.role };
}
