import { ObjectId, type Filter } from "mongodb";
import type { Database, SessionDocument, UserDocument } from "../../infra/database.js";
import type { AuthStore, SessionRecord, UserRecord } from "./types.js";

/** Maps the auth port to L1's typed collections; tokens are never persisted in clear text. */
export function createMongoAuthStore(database: Database): AuthStore {
  const { users, sessions } = database.collections;
  return {
    async findUserByNormalizedEmail(email) {
      const document = await users.findOne({ emailNormalized: email });
      return document ? toUserRecord(document) : null;
    },
    async findUserById(id) {
      if (!ObjectId.isValid(id)) return null;
      const document = await users.findOne({ _id: new ObjectId(id) });
      return document ? toUserRecord(document) : null;
    },
    async insertUser(input) {
      const result = await users.insertOne({
        _id: new ObjectId(), name: input.name, emailNormalized: input.emailNormalized,
        passwordHash: input.passwordHash, role: "GUEST", active: true,
        createdAt: input.createdAt, updatedAt: input.updatedAt,
      });
      const document = await users.findOne({ _id: result.insertedId });
      if (!document) throw new Error("Created user could not be reloaded.");
      return toUserRecord(document);
    },
    async insertSession(input) {
      const document: SessionDocument = {
        _id: new ObjectId(), tokenHash: input.tokenHash, userId: new ObjectId(input.userId),
        createdAt: input.createdAt, expiresAt: input.expiresAt,
      };
      await sessions.insertOne(document);
      return toSessionRecord(document);
    },
    async findSessionByTokenHash(tokenHash) {
      const filter: Filter<SessionDocument> = { tokenHash, revokedAt: { $exists: false } };
      const document = await sessions.findOne(filter);
      return document ? toSessionRecord(document) : null;
    },
    async deleteSession(id) {
      if (!ObjectId.isValid(id)) return;
      await sessions.updateOne({ _id: new ObjectId(id), revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
    },
  };
}

function toUserRecord(document: UserDocument): UserRecord {
  return {
    id: document._id.toHexString(), name: document.name, email: document.emailNormalized,
    emailNormalized: document.emailNormalized, passwordHash: document.passwordHash, role: document.role,
    active: document.active, createdAt: document.createdAt, updatedAt: document.updatedAt,
  };
}
function toSessionRecord(document: SessionDocument): SessionRecord {
  return { id: document._id.toHexString(), tokenHash: document.tokenHash, userId: document.userId.toHexString(), createdAt: document.createdAt, expiresAt: document.expiresAt };
}
