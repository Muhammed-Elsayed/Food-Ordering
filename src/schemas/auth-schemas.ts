import { WebError } from "../utilities/web-errors.js";
import type { PublicUser } from "./user-schemas.js";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshTokenExpiresIn: number;
  user: PublicUser;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface EmailInput {
  email: string;
}

export interface EmailCodeInput {
  email: string;
  code: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ResetPasswordInput {
  resetToken: string;
  newPassword: string;
}

export interface RefreshInput {
  refreshToken: string;
}

// The database rejects emails that are not trimmed and lowercase.
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// Accepts "+20 100-123-4567" or "+20 (100) 1234567" and returns E.164: "+201001234567".
export function normalizePhone(phone: string) {
  const compact = phone.replace(/[\s().-]/g, "");
  return /^\+[1-9][0-9]{7,14}$/.test(compact) ? compact : null;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordLength = { min: 8, max: 128 };
const nameLength = { max: 50 };

// Collects every invalid field so the client can show all problems at once.
function readBody(body: unknown) {
  const fields: Record<string, string> = {};
  const values = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const text = (key: string) => typeof values[key] === "string" ? values[key] : undefined;
  const throwIfInvalid = () => {
    if (Object.keys(fields).length) throw WebError.BadRequest("Some fields are invalid.", { fields });
  };
  return { values, fields, text, throwIfInvalid };
}

function readEmail(email: string | undefined, fields: Record<string, string>) {
  const normalized = email === undefined ? "" : normalizeEmail(email);
  if (!emailPattern.test(normalized) || normalized.length > 254) fields.email = "Enter a valid email address.";
  return normalized;
}

// Length is what makes a password strong; no composition rules (NIST SP 800-63B).
function readNewPassword(password: string | undefined, fields: Record<string, string>, key: string) {
  const value = password ?? "";
  if (value.length < passwordLength.min || value.length > passwordLength.max) {
    fields[key] = `Use ${passwordLength.min} to ${passwordLength.max} characters.`;
  }
  return value;
}

export function parseRegister(body: unknown): RegisterInput {
  const { values, fields, text, throwIfInvalid } = readBody(body);
  const email = readEmail(text("email"), fields);
  const password = readNewPassword(text("password"), fields, "password");

  const name = (key: "firstName" | "lastName") => {
    const value = text(key)?.trim() ?? "";
    if (!value || value.length > nameLength.max) fields[key] = `Enter 1 to ${nameLength.max} characters.`;
    return value;
  };
  const firstName = name("firstName");
  const lastName = name("lastName");

  const rawPhone = values.phone;
  const phone = typeof rawPhone === "string" ? normalizePhone(rawPhone) : null;
  const phoneGiven = typeof rawPhone === "string" ? rawPhone.trim() !== "" : rawPhone != null;
  if (phoneGiven && !phone) fields.phone = "Use international format, for example +201001234567.";

  throwIfInvalid();
  return { email, password, firstName, lastName, phone };
}

export function parseLogin(body: unknown): LoginInput {
  const { fields, text, throwIfInvalid } = readBody(body);
  const email = readEmail(text("email"), fields);
  const password = text("password") ?? "";
  // The upper bound keeps hashing cost bounded.
  if (!password || password.length > passwordLength.max) fields.password = "Enter your password.";
  throwIfInvalid();
  return { email, password };
}

export function parseEmail(body: unknown): EmailInput {
  const { fields, text, throwIfInvalid } = readBody(body);
  const email = readEmail(text("email"), fields);
  throwIfInvalid();
  return { email };
}

export function parseEmailCode(body: unknown): EmailCodeInput {
  const { fields, text, throwIfInvalid } = readBody(body);
  const email = readEmail(text("email"), fields);
  const code = text("code")?.trim() ?? "";
  if (!/^[0-9]{6}$/.test(code)) fields.code = "Enter the 6-digit code from the email.";
  throwIfInvalid();
  return { email, code };
}

export function parseRefresh(body: unknown): RefreshInput {
  const { fields, text, throwIfInvalid } = readBody(body);
  const refreshToken = text("refreshToken") ?? "";
  if (!refreshToken || refreshToken.length > 100) fields.refreshToken = "Send the refresh token from your last login.";
  throwIfInvalid();
  return { refreshToken };
}

export function parseResetPassword(body: unknown): ResetPasswordInput {
  const { fields, text, throwIfInvalid } = readBody(body);
  const resetToken = text("resetToken") ?? "";
  if (!resetToken || resetToken.length > 1000) fields.resetToken = "Send the reset token from the code step.";
  const newPassword = readNewPassword(text("newPassword"), fields, "newPassword");
  throwIfInvalid();
  return { resetToken, newPassword };
}

export function parseChangePassword(body: unknown): ChangePasswordInput {
  const { fields, text, throwIfInvalid } = readBody(body);
  const currentPassword = text("currentPassword") ?? "";
  if (!currentPassword || currentPassword.length > passwordLength.max) {
    fields.currentPassword = "Enter your current password.";
  }
  const newPassword = readNewPassword(text("newPassword"), fields, "newPassword");
  throwIfInvalid();
  return { currentPassword, newPassword };
}
