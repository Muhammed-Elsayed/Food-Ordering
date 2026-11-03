import { otpConfig } from "../config/index.js";
import { database, type Database } from "../db/index.js";
import type { CodeCheck, EmailCodePurpose, EmailSender } from "../schemas/email-schemas.js";
import { consoleEmailSender } from "../utilities/email.js";
import { codeMatches, createCode, hashCode } from "../utilities/otp.js";

const secondsFromNow = (seconds: number) => new Date(Date.now() + seconds * 1000);

// One code per email and purpose: sending replaces the previous code and its attempts.
export class EmailCodeService {
  constructor(private readonly db: Database, private readonly email: EmailSender) {}

  // Sends a new code unless one went out within the cooldown. Returns the seconds still
  // to wait, or 0 when a code was sent.
  async send(email: string, purpose: EmailCodePurpose) {
    const key = { email_purpose: { email, purpose } };
    const previous = await this.db.client.emailCode.findUnique({ where: key, select: { codeSentAt: true } });
    const wait = previous ? otpConfig.resendCooldown - (Date.now() - previous.codeSentAt.getTime()) / 1000 : 0;
    if (wait > 0) return Math.ceil(wait);

    const code = createCode();
    const fields = {
      codeHash: hashCode(purpose, email, code), codeSentAt: new Date(),
      expiresAt: secondsFromNow(otpConfig.codeExpiresIn), attempts: 0,
    };
    await this.db.client.emailCode.upsert({ where: key, create: { email, purpose, ...fields }, update: fields });
    await this.email.sendCode(email, purpose, code);
    return 0;
  }

  async check(email: string, purpose: EmailCodePurpose, code: string): Promise<CodeCheck> {
    const key = { email_purpose: { email, purpose } };
    const saved = await this.db.client.emailCode.findUnique({ where: key });
    if (!saved) return { status: "missing" };
    if (saved.expiresAt.getTime() <= Date.now()) return { status: "expired" };

    // Counted before comparing, so parallel guesses cannot exceed the limit.
    const { count } = await this.db.client.emailCode.updateMany({
      where: { email, purpose, attempts: { lt: otpConfig.maxAttempts } }, data: { attempts: { increment: 1 } },
    });
    if (count === 0) return { status: "locked" };
    if (!codeMatches(purpose, email, code, saved.codeHash)) {
      return { status: "wrong", attemptsLeft: otpConfig.maxAttempts - saved.attempts - 1 };
    }
    return { status: "ok" };
  }

  async consume(email: string, purpose: EmailCodePurpose) {
    await this.db.client.emailCode.deleteMany({ where: { email, purpose } });
  }
}

export const emailCodeService = new EmailCodeService(database, consoleEmailSender);
