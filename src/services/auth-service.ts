import type { Auth } from "googleapis";
import { randomUUID } from "node:crypto";
import { jwtConfig, otpConfig, passwordResetConfig, sessionConfig } from "../config/index.js";
import { generatePasswordResetToken, generateToken, readPasswordResetToken } from "../middleware/JWT.js";
import {
  normalizeEmail, type AuthSession, type ChangePasswordInput, type EmailCodeInput, type EmailInput, type LoginInput,
  type RefreshInput, type RegisterInput, type ResetPasswordInput,
} from "../schemas/auth-schemas.js";
import type { EmailSender } from "../schemas/email-schemas.js";
import type { NewUser, PublicUser, SignInMethod } from "../schemas/user-schemas.js";
import { consoleEmailSender } from "../utilities/email.js";
import { hashPassword, passwordFingerprint, verifyPassword } from "../utilities/passwords.js";
import { createRefreshToken, hashRefreshToken } from "../utilities/tokens.js";
import { WebError } from "../utilities/web-errors.js";
import { emailCodeService, type EmailCodeService } from "./email-code-service.js";
import { pendingRegistrationService, type PendingRegistrationService } from "./pending-registration-service.js";
import { sessionService, type SessionService } from "./session-service.js";
import { userService, type UserService } from "./user-service.js";

const optionalName = (name?: string) => name?.trim() || null;

const secondsFromNow = (seconds: number) => new Date(Date.now() + seconds * 1000);

// Accounts are never linked: an email keeps the method it was registered with.
// Keyed by the method being attempted, then by the method that owns the email.
const emailTakenMessages: Record<SignInMethod, Record<SignInMethod, string>> = {
  google: {
    google: "This email is already registered with a different Google account.",
    password: "This email is registered with a password. Log in with your email and password.",
  },
  password: {
    google: "This email is already registered with Google. Use Continue with Google.",
    password: "This email is already registered. Log in with your email and password.",
  },
};

const invalidCredentials = () => WebError.UnAuthorized("Invalid email or password.");
const sessionEnded = () => WebError.UnAuthorized("Your session has ended. Log in again.");
const noSignUpWaiting = () => WebError.BadRequest("No sign-up is waiting for this email. Register again.");
// Password reset answers every failure the same way, so it never reveals which emails have accounts.
const resetCodeInvalid = () => WebError.BadRequest("This code is wrong or has expired.");
const resetExpired = () => WebError.BadRequest("This password reset has expired. Ask for a new code.");

const sessionResponse = (accessToken: string, refreshToken: string, user: PublicUser): AuthSession => ({
  accessToken, refreshToken, tokenType: "Bearer",
  expiresIn: jwtConfig.accessTokenExpiresIn, refreshTokenExpiresIn: sessionConfig.refreshTokenExpiresIn, user,
});

// Knows nothing about Express: takes plain values, returns results, throws WebErrors.
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly sessions: SessionService,
    private readonly registrations: PendingRegistrationService,
    private readonly codes: EmailCodeService,
    private readonly email: EmailSender,
  ) {}

  // Accounts are matched only by Google's stable `sub`, never by email.
  async loginWithGoogle(identity: Auth.TokenPayload): Promise<{ created: boolean; session: AuthSession }> {
    const account = await this.users.findByGoogleSub(identity.sub);
    if (account) return { created: false, session: await this.logIn(account) };

    if (!identity.email || identity.email_verified !== true) {
      throw WebError.Forbidden("Your Google account's email is not verified, so it cannot be used to create an account.");
    }

    const email = normalizeEmail(identity.email);
    const created = await this.createAndLogIn({
      email, googleSub: identity.sub, emailVerified: true,
      firstName: optionalName(identity.given_name), lastName: optionalName(identity.family_name),
    });
    if (created) return { created: true, session: created };

    // A parallel first login created this Google account, or another account owns the email.
    const createdInParallel = await this.users.findByGoogleSub(identity.sub);
    if (!createdInParallel) throw await this.emailTaken(email, "google");
    return { created: false, session: await this.logIn(createdInParallel) };
  }

  // The account is created only by verifyRegistration, once the emailed code matches.
  // Registering again within the cooldown keeps the code already sent.
  async register(input: RegisterInput) {
    if (await this.users.findByEmail(input.email)) throw await this.emailTaken(input.email, "password");

    const passwordHash = await hashPassword(input.password);
    await this.codes.send(input.email, "register");
    await this.registrations.save({
      email: input.email, passwordHash, firstName: input.firstName, lastName: input.lastName, phone: input.phone,
    });
    return { email: input.email, expiresIn: otpConfig.codeExpiresIn };
  }

  async resendCode({ email }: EmailInput) {
    if (!(await this.registrations.find(email))) throw noSignUpWaiting();
    const wait = await this.codes.send(email, "register");
    if (wait > 0) throw WebError.TooManyRequests(`Wait ${wait} seconds before asking for another code.`);
    return { email, expiresIn: otpConfig.codeExpiresIn };
  }

  async verifyRegistration({ email, code }: EmailCodeInput): Promise<AuthSession> {
    const result = await this.codes.check(email, "register", code);
    if (result.status === "missing") throw noSignUpWaiting();
    if (result.status === "expired") throw WebError.BadRequest("This code has expired. Ask for a new one.");
    if (result.status === "locked") throw WebError.BadRequest("Too many wrong codes. Ask for a new one.");
    if (result.status === "wrong") throw WebError.BadRequest("The code is wrong.", { attemptsLeft: result.attemptsLeft });

    const pending = await this.registrations.find(email);
    if (!pending) throw noSignUpWaiting();
    const session = await this.createAndLogIn({
      email, passwordHash: pending.passwordHash, firstName: pending.firstName, lastName: pending.lastName,
      phone: pending.phone, emailVerified: true,
    });
    await this.codes.consume(email, "register");
    await this.registrations.delete(email);
    // The email was taken after the code was sent, e.g. by Continue with Google.
    if (!session) throw await this.emailTaken(email, "password");
    return session;
  }

  // Always the same answer. Only active password accounts get a code (within the cooldown,
  // nothing new is sent); Google accounts get a reminder to use Google.
  async forgotPassword({ email }: EmailInput) {
    const account = await this.users.findByEmail(email);
    if (account?.isActive && account.googleSub) await this.email.sendGoogleAccountNotice(email);
    else if (account?.isActive && account.passwordHash) await this.codes.send(email, "password_reset");
    return { email, expiresIn: otpConfig.codeExpiresIn };
  }

  async verifyResetCode({ email, code }: EmailCodeInput) {
    const result = await this.codes.check(email, "password_reset", code);
    if (result.status !== "ok") throw resetCodeInvalid();

    const account = await this.users.findByEmail(email);
    if (!account?.isActive || !account.passwordHash) throw resetCodeInvalid();
    const resetToken = generatePasswordResetToken({ sub: account.id, pwf: passwordFingerprint(account.passwordHash) });
    await this.codes.consume(email, "password_reset");
    return { resetToken, expiresIn: passwordResetConfig.tokenExpiresIn };
  }

  // Ends every session (whoever knew the old password is signed out) and logs this device in.
  async resetPassword({ resetToken, newPassword }: ResetPasswordInput): Promise<AuthSession> {
    const payload = readPasswordResetToken(resetToken);
    if (!payload) throw resetExpired();

    const account = await this.users.findPasswordAccount(payload.sub);
    if (!account?.isActive || !account.passwordHash || passwordFingerprint(account.passwordHash) !== payload.pwf) {
      throw resetExpired();
    }

    const newHash = await hashPassword(newPassword);
    const { accessToken, refreshToken, session } = this.newSession(payload.sub);
    const user = await this.users.replacePassword(payload.sub, account.passwordHash, newHash, session);
    if (!user) throw resetExpired();
    return sessionResponse(accessToken, refreshToken, user);
  }

  // Keeps this device logged in, ends the others, and tells the owner by email.
  async changePassword(userId: string, sessionId: string, { currentPassword, newPassword }: ChangePasswordInput) {
    const account = await this.users.findPasswordAccount(userId);
    if (!account?.isActive) throw sessionEnded();
    if (account.googleSub || !account.passwordHash) {
      throw WebError.Conflict("This account signs in with Google, so it has no password to change.", { signInMethod: "google" });
    }
    // 400, not 401: a 401 would make the client refresh its tokens and retry.
    if (!(await verifyPassword(account.passwordHash, currentPassword))) {
      throw WebError.BadRequest("Some fields are invalid.", { fields: { currentPassword: "Your current password is wrong." } });
    }

    const newHash = await hashPassword(newPassword);
    if (!(await this.users.changePassword(userId, account.passwordHash, newHash, sessionId))) {
      throw WebError.Conflict("Your password changed while this request was running. Try again.");
    }
    await this.email.sendPasswordChangedNotice(account.email);
  }

  async loginWithPassword({ email, password }: LoginInput): Promise<AuthSession> {
    const account = await this.users.findByEmail(email);
    if (account?.googleSub) {
      throw WebError.Conflict(emailTakenMessages.password.google, { signInMethod: "google" });
    }
    // Runs even for unknown emails, so timing does not reveal which emails are registered.
    if (!(await verifyPassword(account?.passwordHash, password)) || !account) {
      throw invalidCredentials();
    }
    return this.logIn(account);
  }

  async refresh({ refreshToken }: RefreshInput): Promise<AuthSession> {
    const oldHash = hashRefreshToken(refreshToken);
    const session = await this.sessions.findByRefreshTokenHash(oldHash);
    if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) throw sessionEnded();

    const next = createRefreshToken();
    const accessToken = generateToken({ sub: session.userId, sid: session.id });
    const rotated = await this.sessions.rotate(session.id, oldHash, {
      refreshTokenHash: next.hash, expiresAt: secondsFromNow(sessionConfig.refreshTokenExpiresIn),
    });
    if (!rotated) throw sessionEnded();

    const { isActive: _isActive, ...user } = session.user;
    return sessionResponse(accessToken, next.token, user);
  }

  // Ends every session of the user, on every device.
  async logout(userId: string) {
    await this.sessions.deleteAllForUser(userId);
  }

  private async logIn(account: { id: string; isActive: boolean }): Promise<AuthSession> {
    if (!account.isActive) throw WebError.Forbidden("This account is disabled.");
    const { accessToken, refreshToken, session } = this.newSession(account.id);
    const user = await this.sessions.create(account.id, session);
    return sessionResponse(accessToken, refreshToken, user);
  }

  // Returns null if the email or Google account is taken.
  private async createAndLogIn(user: Omit<NewUser, "id">): Promise<AuthSession | null> {
    const id = randomUUID();
    const { accessToken, refreshToken, session } = this.newSession(id);
    const created = await this.users.createWithSession({ ...user, id }, session);
    return created ? sessionResponse(accessToken, refreshToken, created) : null;
  }

  // Signs before anything is saved, so a signing failure stores nothing.
  private newSession(userId: string) {
    const id = randomUUID();
    const refresh = createRefreshToken();
    const accessToken = generateToken({ sub: userId, sid: id });
    const session = {
      id, refreshTokenHash: refresh.hash, expiresAt: secondsFromNow(sessionConfig.refreshTokenExpiresIn),
    };
    return { accessToken, refreshToken: refresh.token, session };
  }

  private async emailTaken(email: string, attempted: SignInMethod) {
    const owner = await this.users.findByEmail(email);
    const signInMethod: SignInMethod = owner?.googleSub ? "google" : "password";
    return WebError.Conflict(emailTakenMessages[attempted][signInMethod], { signInMethod });
  }
}

export const authService = new AuthService(
  userService, sessionService, pendingRegistrationService, emailCodeService, consoleEmailSender,
);
