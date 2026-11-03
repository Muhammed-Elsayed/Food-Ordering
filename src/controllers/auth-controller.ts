import type { RequestHandler, Response } from "express";
import type { Auth } from "googleapis";
import type {
  ChangePasswordInput, EmailCodeInput, EmailInput, LoginInput, RefreshInput, RegisterInput, ResetPasswordInput,
} from "../schemas/auth-schemas.js";
import type { AuthenticatedLocals, ValidatedHandler } from "../schemas/request-schemas.js";
import type { AuthService } from "../services/auth-service.js";

// HTTP only: read the validated input, call AuthService, send the response.
class AuthController {
  constructor(private readonly auth: AuthService) {}

  public readonly loginWithGoogle = async (identity: Auth.TokenPayload, res: Response) => {
    const { created, session } = await this.auth.loginWithGoogle(identity);
    res.status(created ? 201 : 200).json(session);
  };

  public readonly register: ValidatedHandler<RegisterInput> = async (_req, res) => {
    const pending = await this.auth.register(res.locals.input);
    res.status(202).json({ message: "We sent a 6-digit code to your email.", ...pending });
  };

  public readonly resendCode: ValidatedHandler<EmailInput> = async (_req, res) => {
    const pending = await this.auth.resendCode(res.locals.input);
    res.status(202).json({ message: "We sent a new code to your email.", ...pending });
  };

  public readonly verifyRegistration: ValidatedHandler<EmailCodeInput> = async (_req, res) => {
    res.status(201).json(await this.auth.verifyRegistration(res.locals.input));
  };

  public readonly forgotPassword: ValidatedHandler<EmailInput> = async (_req, res) => {
    const pending = await this.auth.forgotPassword(res.locals.input);
    res.status(202).json({ message: "If this email has a password account, we sent it a code.", ...pending });
  };

  public readonly verifyResetCode: ValidatedHandler<EmailCodeInput> = async (_req, res) => {
    res.json(await this.auth.verifyResetCode(res.locals.input));
  };

  public readonly resetPassword: ValidatedHandler<ResetPasswordInput> = async (_req, res) => {
    res.json(await this.auth.resetPassword(res.locals.input));
  };

  public readonly changePassword: ValidatedHandler<ChangePasswordInput, AuthenticatedLocals> = async (_req, res) => {
    await this.auth.changePassword(res.locals.user.id, res.locals.sessionId, res.locals.input);
    res.status(204).end();
  };

  public readonly loginWithPassword: ValidatedHandler<LoginInput> = async (_req, res) => {
    res.json(await this.auth.loginWithPassword(res.locals.input));
  };

  public readonly refresh: ValidatedHandler<RefreshInput> = async (_req, res) => {
    res.json(await this.auth.refresh(res.locals.input));
  };

  public readonly logout: RequestHandler = async (_req, res) => {
    await this.auth.logout(res.locals.user.id);
    res.status(204).end();
  };

  public readonly me: RequestHandler = (_req, res) => {
    res.json({ user: res.locals.user });
  };
}

export default AuthController;
