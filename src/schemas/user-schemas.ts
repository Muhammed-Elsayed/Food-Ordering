// The user fields returned to the account owner (publicUserFields in UserService).
export interface PublicUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
}

export type SignInMethod = "google" | "password";

export interface NewUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone?: string | null;
  emailVerified: boolean;
  // Exactly one of these.
  googleSub?: string;
  passwordHash?: string;
}

export interface NewSession {
  id: string;
  refreshTokenHash: string;
  expiresAt: Date;
}

export interface NewPendingRegistration {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}
