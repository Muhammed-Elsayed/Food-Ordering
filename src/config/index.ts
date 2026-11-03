import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

export const port = Number(process.env.PORT ?? 3000);

export const databaseConfig = { url: process.env.DATABASE_URL };

export const googleAuthConfig = {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  redirectUri: process.env.OAUTH_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`,
};

// Lifetimes are in seconds.
export const jwtConfig = {
  secretKey: process.env.JWT_SECRET_KEY,
  accessTokenExpiresIn: 15 * 60,
};

// Each refresh rotates the token and restarts its lifetime.
export const sessionConfig = {
  refreshTokenExpiresIn: 24 * 60 * 60,
};

export const otpConfig = {
  secretKey: process.env.OTP_SECRET_KEY,
  codeExpiresIn: 10 * 60,
  maxAttempts: 5,
  resendCooldown: 60,
};

// The token issued after a correct reset code, used to set the new password.
export const passwordResetConfig = {
  tokenExpiresIn: 10 * 60,
};
