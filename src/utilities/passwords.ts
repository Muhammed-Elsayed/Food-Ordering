import argon2 from "argon2";
import { createHash } from "node:crypto";

// argon2id with the library's defaults: 64 MiB of memory and 3 passes per hash.
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

// Verified when there is no account, so unknown emails take as long as wrong passwords.
// Created at startup so the first such login is not slower.
const dummyHash = hashPassword("dummy password for timing");

export async function verifyPassword(passwordHash: string | null | undefined, password: string) {
  if (!passwordHash) {
    await argon2.verify(await dummyHash, password);
    return false;
  }
  return argon2.verify(passwordHash, password);
}

// Changes whenever the password does (argon2 hashes are salted), so a token carrying it
// stops working once the password is changed.
export const passwordFingerprint = (passwordHash: string) =>
  createHash("sha256").update(passwordHash).digest("base64url").slice(0, 22);
