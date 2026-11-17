import { randomUUID } from 'node:crypto';
import type { Mailer } from './Mailer.js';

export class MailDeliveryError extends Error {
  constructor() { super('Sign-in email could not be sent'); }
}

/** Server-only transactional email. No recipients, codes, keys or provider bodies are logged. */
export class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string,
    private readonly fetcher: typeof fetch = fetch) {}

  async sendSignInCode(email: string, code: string) {
    try {
      const response = await this.fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ from: this.from, to: [email], subject: 'Your Gossamer sign-in code',
          text: `Your Gossamer sign-in code is ${code}.\n\nIt expires in 10 minutes and can be used once.\nIf you did not request this code, ignore this email.` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new MailDeliveryError();
      const payload = await response.json() as { id?: unknown };
      if (typeof payload.id !== 'string' || !payload.id) throw new MailDeliveryError();
    } catch {
      // Never propagate a network exception that might contain request credentials/content.
      throw new MailDeliveryError();
    }
  }
}
