export type EmailCodePurpose = "register" | "password_reset";

// Outcome of checking a code; "wrong" carries the attempts left for that code.
export type CodeCheck =
  | { status: "ok" }
  | { status: "missing" | "expired" | "locked" }
  | { status: "wrong"; attemptsLeft: number };

export interface EmailSender {
  sendCode(to: string, purpose: EmailCodePurpose, code: string): Promise<void>;
  sendGoogleAccountNotice(to: string): Promise<void>;
  sendPasswordChangedNotice(to: string): Promise<void>;
}
