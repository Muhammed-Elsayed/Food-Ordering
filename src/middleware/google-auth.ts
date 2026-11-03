import type { RequestHandler } from "express";
import { google, Auth } from "googleapis";
import { randomBytes } from "node:crypto";
import type { GoogleAuthConfig, VerifiedIdentityHandler } from "../schemas/google-auth-schemas.js";

// Create once per app so login and callback share the same pending attempts.
export function createGoogleAuthHandlers(
  { clientId, clientSecret, redirectUri }: GoogleAuthConfig, onVerifiedIdentity: VerifiedIdentityHandler,
) {
  const oidcScopes = ["openid", "email", "profile"];
  const oauth = new google.auth.OAuth2({
    clientId, clientSecret, redirectUri,
    transporterOptions: { timeout: 10_000, maxRedirects: 0 },
  });

  const lifetime = 10 * 60 * 1000;
  const cookieName = "oauth_browser";
  const cookieOptions = {
    httpOnly: true, sameSite: "lax" as const,
    secure: new URL(redirectUri).protocol === "https:", path: "/auth",
  };
  const attempts = new Map<string, {
    codeVerifier: string; browserBinding: string; nonce: string; expiresAt: number;
  }>();
  const cleanup = setInterval(() => {
    for (const [state, attempt] of attempts) {
      if (attempt.expiresAt <= Date.now()) attempts.delete(state);
    }
  }, 60_000);
  cleanup.unref();

  const authMiddleware: RequestHandler = (_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (!clientId || !clientSecret) {
      res.status(503).json({ message: "Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in .env, then restart." });
      return;
    }
    next();
  };

  const startGoogleAuthorization: RequestHandler = async (_req, res) => {
    try {
      const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
      const state = randomBytes(32).toString("base64url");
      const browserBinding = randomBytes(32).toString("base64url");
      // Binds the returned ID token to this attempt.
      const nonce = randomBytes(32).toString("base64url");
      attempts.set(state, { codeVerifier, browserBinding, nonce, expiresAt: Date.now() + lifetime });
      res.cookie(cookieName, browserBinding, { ...cookieOptions, maxAge: lifetime });
      res.redirect(oauth.generateAuthUrl({
        scope: oidcScopes, prompt: "select_account", state, nonce,
        code_challenge: codeChallenge, code_challenge_method: Auth.CodeChallengeMethod.S256,
      }));
    } catch {
      res.status(500).json({ message: "Could not start authorization. Try again." });
    }
  };

  const handleGoogleCallback: RequestHandler = async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const attempt = state ? attempts.get(state) : undefined;
    const browserBinding = req.headers.cookie?.split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);

    if (!state || !attempt || attempt.expiresAt <= Date.now() ||
        browserBinding !== attempt.browserBinding) {
      res.status(400).json({ message: "Invalid or expired attempt. Start again at /auth/google." });
      return;
    }
    // Consume once before exchanging the code so callbacks cannot be replayed.
    attempts.delete(state);
    res.clearCookie(cookieName, cookieOptions);
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    if (req.query.error !== undefined || !code) {
      res.status(400).json({ message: "Google did not authorize the request or return a code." });
      return;
    }

    let identity: Auth.TokenPayload;
    try {
      const { tokens } = await oauth.getToken({ code, codeVerifier: attempt.codeVerifier });
      if (typeof tokens.access_token !== "string" || !tokens.access_token || tokens.token_type?.toLowerCase() !== "bearer" ||
          !tokens.expiry_date || !Number.isFinite(tokens.expiry_date) || tokens.expiry_date <= Date.now()) {
        throw new Error("Invalid token response");
      }
      if (typeof tokens.id_token !== "string" || !tokens.id_token) {
        throw new Error("Missing ID token");
      }
      // The library checks signature, issuer, expiry, and audience; the nonce is ours to check.
      try {
        const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
        const payload = ticket.getPayload();
        if (!payload || payload.nonce !== attempt.nonce ||
            typeof payload.sub !== "string" || !payload.sub.trim()) {
          throw new Error("Invalid identity or nonce");
        }
        identity = payload;
      } catch {
        res.status(401).json({ message: "Could not verify the Google identity. Start again at /auth/google." });
        return;
      }
    } catch {
      res.status(502).json({ message: "Token exchange failed. Check the client settings and start again at /auth/google." });
      return;
    }

    // Google's tokens are never returned or stored. Outside the try above, so app errors
    // (e.g. database) are not reported as Google failures.
    await onVerifiedIdentity(identity, res);
  };

  return { authMiddleware, startGoogleAuthorization, handleGoogleCallback };
}
