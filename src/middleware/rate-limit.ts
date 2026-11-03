import { rateLimit, type Options } from "express-rate-limit";
import { WebError } from "../utilities/web-errors.js";

const minutes = (count: number) => count * 60 * 1000;

function limiter(windowMs: number, limit: number, message: string, options: Partial<Options> = {}) {
  return rateLimit({
    windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false,
    handler: (_req, _res, next) => next(WebError.TooManyRequests(message)),
    ...options,
  });
}

// Mount after validate(): keys on the normalized email, whichever network the requests come from.
const byEmail: Partial<Options> = { keyGenerator: (_req, res) => `email:${res.locals.input.email}` };

// Mount after verifyToken.
const byUser: Partial<Options> = { keyGenerator: (_req, res) => `user:${res.locals.user.id}` };

// Create once per app. Counts live in this process's memory: they reset on restart and are
// not shared between servers (use a Redis store for that).
export function createAuthRateLimits() {
  return {
    // Every attempt counts, so one address cannot keep the server busy hashing passwords.
    loginByIp: limiter(minutes(15), 20, "Too many login attempts from your network. Try again later."),
    // Only failures count, so the owner logging in never uses up their own limit.
    loginByEmail: limiter(minutes(15), 5, "Too many failed logins for this email. Try again later.",
      { ...byEmail, skipSuccessfulRequests: true }),
    registerByIp: limiter(minutes(60), 10, "Too many sign-ups from your network. Try again later."),
    registerByEmail: limiter(minutes(60), 5, "Too many sign-up attempts for this email. Try again later.", byEmail),
    // Wrong codes are also capped per code (otpConfig.maxAttempts).
    verifyByIp: limiter(minutes(15), 30, "Too many verification attempts from your network. Try again later."),
    resendByIp: limiter(minutes(60), 10, "Too many code requests from your network. Try again later."),
    resendByEmail: limiter(minutes(60), 5, "Too many code requests for this email. Try again later.", byEmail),
    forgotByIp: limiter(minutes(60), 10, "Too many password reset requests from your network. Try again later."),
    forgotByEmail: limiter(minutes(60), 5, "Too many password reset requests for this email. Try again later.", byEmail),
    verifyResetByIp: limiter(minutes(15), 30, "Too many code attempts from your network. Try again later."),
    resetByIp: limiter(minutes(15), 10, "Too many password resets from your network. Try again later."),
    changePasswordByIp: limiter(minutes(15), 20, "Too many password changes from your network. Try again later."),
    // Only failures count, so a stolen access token cannot be used to guess the password.
    changePasswordByUser: limiter(minutes(15), 5, "Too many wrong current passwords. Try again later.",
      { ...byUser, skipSuccessfulRequests: true }),
    refreshByIp: limiter(minutes(15), 60, "Too many refresh attempts from your network. Try again later."),
  };
}
