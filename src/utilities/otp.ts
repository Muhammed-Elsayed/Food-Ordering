import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { otpConfig } from "../config/index.js";
import type { EmailCodePurpose } from "../schemas/email-schemas.js";
import { WebError } from "./web-errors.js";

const secretKey = () => {
  if (!otpConfig.secretKey) {
    throw new WebError(503, "MissingConfigError", "Set OTP_SECRET_KEY in .env, then restart.");
  }
  return otpConfig.secretKey;
};

export const createCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

// A 6-digit code is easy to brute-force from a plain hash, so it is keyed with a server
// secret. Binding the purpose and email means a code works only for what it was sent for.
export const hashCode = (purpose: EmailCodePurpose, email: string, code: string) =>
  createHmac("sha256", secretKey()).update(`${purpose}:${email}:${code}`).digest("hex");

export const codeMatches = (purpose: EmailCodePurpose, email: string, code: string, codeHash: string) =>
  timingSafeEqual(Buffer.from(hashCode(purpose, email, code), "hex"), Buffer.from(codeHash, "hex"));
