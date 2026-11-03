import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { jwtConfig, passwordResetConfig } from "../config/index.js";
import type { AccessTokenPayload, PasswordResetTokenPayload } from "../schemas/token-schemas.js";
import { sessionService } from "../services/session-service.js";
import { WebError } from "../utilities/web-errors.js";

// Every token names its purpose, so a token for one purpose is rejected for another.
const accessAudience = "access";
const passwordResetAudience = "password-reset";

const secretKey = () => {
  if (!jwtConfig.secretKey) {
    throw new WebError(503, "MissingConfigError", "Set JWT_SECRET_KEY in .env, then restart.");
  }
  return jwtConfig.secretKey;
};

const invalidToken = () =>
  new WebError(401, "InvalidTokenError", "The provided token is invalid or expired, please login first");

// Expects `Authorization: Bearer <token>`. On success, res.locals holds the current user and
// session id (AuthenticatedLocals).
export const verifyToken: RequestHandler = async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) {
    throw new WebError(401, "MissingTokenError", "Missing authentication token, please login first");
  }

  // Read before verifying, so a missing secret stays a 503 instead of an invalid-token 401.
  const secret = secretKey();
  let decodedToken: string | jwt.JwtPayload;
  try {
    decodedToken = jwt.verify(token, secret, { algorithms: ["HS256"], audience: accessAudience });
  } catch {
    throw invalidToken();
  }

  if (typeof decodedToken !== "object" || typeof decodedToken.sub !== "string" ||
      typeof decodedToken.sid !== "string") {
    throw invalidToken();
  }

  // A logout or a disabled account ends the session before the token expires.
  const user = await sessionService.findActiveUser(decodedToken.sid, decodedToken.sub);
  if (!user) {
    throw WebError.UnAuthorized("Your session has ended. Log in again.");
  }

  res.locals.user = user;
  res.locals.sessionId = decodedToken.sid;
  next();
};

export const generateToken = (payload: AccessTokenPayload) => {
  return jwt.sign(payload, secretKey(), {
    algorithm: "HS256", audience: accessAudience, expiresIn: jwtConfig.accessTokenExpiresIn,
  });
};

export const generatePasswordResetToken = (payload: PasswordResetTokenPayload) => {
  return jwt.sign(payload, secretKey(), {
    algorithm: "HS256", audience: passwordResetAudience, expiresIn: passwordResetConfig.tokenExpiresIn,
  });
};

// Returns null for anything that is not a live password-reset token.
export const readPasswordResetToken = (token: string): PasswordResetTokenPayload | null => {
  const secret = secretKey();
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"], audience: passwordResetAudience });
    if (typeof decoded === "object" && typeof decoded.sub === "string" && typeof decoded.pwf === "string") {
      return { sub: decoded.sub, pwf: decoded.pwf };
    }
  } catch {
    // Invalid or expired.
  }
  return null;
};
