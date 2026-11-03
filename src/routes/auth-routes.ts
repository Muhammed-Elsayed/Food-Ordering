import { Router } from "express";
import type AuthController from "../controllers/auth-controller.js";
import { createGoogleAuthHandlers } from "../middleware/google-auth.js";
import { verifyToken } from "../middleware/JWT.js";
import { createAuthRateLimits } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  parseChangePassword, parseEmail, parseEmailCode, parseLogin, parseRefresh, parseRegister, parseResetPassword,
} from "../schemas/auth-schemas.js";
import type { GoogleAuthConfig } from "../schemas/google-auth-schemas.js";

class AuthRoutes {
  public readonly router = Router();
  private readonly handlers: ReturnType<typeof createGoogleAuthHandlers>;
  private readonly limits = createAuthRateLimits();

  constructor(googleAuthConfig: GoogleAuthConfig, private readonly controller: AuthController) {
    this.handlers = createGoogleAuthHandlers(googleAuthConfig, controller.loginWithGoogle);
    this.initializeAuthRoutes();
  }

  // Order: verifyToken or the per-IP limit, then validate, then the per-email or per-user
  // limit (it keys on the validated email or the token's user), then the controller.
  private initializeAuthRoutes() {
    const { authMiddleware, startGoogleAuthorization, handleGoogleCallback } = this.handlers;
    const limits = this.limits;
    const controller = this.controller;

    this.router.get("/google", authMiddleware, startGoogleAuthorization);
    this.router.get("/google/callback", authMiddleware, handleGoogleCallback);
    this.router.post("/register",
      limits.registerByIp, validate(parseRegister), limits.registerByEmail, controller.register);
    this.router.post("/register/verify",
      limits.verifyByIp, validate(parseEmailCode), controller.verifyRegistration);
    this.router.post("/register/resend",
      limits.resendByIp, validate(parseEmail), limits.resendByEmail, controller.resendCode);
    this.router.post("/login",
      limits.loginByIp, validate(parseLogin), limits.loginByEmail, controller.loginWithPassword);
    this.router.post("/password/change", verifyToken, limits.changePasswordByIp,
      validate(parseChangePassword), limits.changePasswordByUser, controller.changePassword);
    this.router.post("/password/forgot",
      limits.forgotByIp, validate(parseEmail), limits.forgotByEmail, controller.forgotPassword);
    this.router.post("/password/verify-code",
      limits.verifyResetByIp, validate(parseEmailCode), controller.verifyResetCode);
    this.router.post("/password/reset", limits.resetByIp, validate(parseResetPassword), controller.resetPassword);
    this.router.post("/refresh", limits.refreshByIp, validate(parseRefresh), controller.refresh);
    this.router.post("/logout", verifyToken, controller.logout);
    this.router.get("/me", verifyToken, controller.me);
  }
}

export default AuthRoutes;
