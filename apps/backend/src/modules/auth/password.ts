import argon2 from "argon2";
import type { PasswordHasher } from "./types.js";

/** Argon2id with OWASP-recommended interactive parameters and an encoded salt. */
export const argon2PasswordHasher: PasswordHasher = {
  hash: (password) => argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  }),
  verify: async (encoded, password) => {
    try { return await argon2.verify(encoded, password); }
    catch { return false; }
  },
};
