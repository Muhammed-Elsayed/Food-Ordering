import type { EmailCodePurpose, EmailSender } from "../schemas/email-schemas.js";

const codeSubjects: Record<EmailCodePurpose, string> = {
  register: "verification code",
  password_reset: "password reset code",
};

// Development stand-in: prints emails instead of sending them. Replace with a real
// provider before launch.
export const consoleEmailSender: EmailSender = {
  async sendCode(to, purpose, code) {
    console.log(`[email] To: ${to} | Your Food Ordering ${codeSubjects[purpose]} is ${code}`);
  },
  async sendGoogleAccountNotice(to) {
    console.log(`[email] To: ${to} | You sign in to Food Ordering with Google. Use Continue with Google; there is no password to reset.`);
  },
  async sendPasswordChangedNotice(to) {
    console.log(`[email] To: ${to} | Your Food Ordering password was changed. If this wasn't you, reset it now.`);
  },
};
