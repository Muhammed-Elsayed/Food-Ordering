import { createHash, randomBytes } from "node:crypto";

// Refresh tokens are 256 random bits, so a plain SHA-256 is enough to store them safely.
export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createRefreshToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}
