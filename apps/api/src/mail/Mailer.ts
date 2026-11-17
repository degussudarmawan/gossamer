// What the rest of the app knows about sending email. Swapping the provider
// means writing another class that implements this, and nothing else changes.
export interface Mailer {
  sendSignInCode(email: string, code: string): Promise<void>;
}

/** Development stand-in for real email: the code is printed where the server runs. */
export class ConsoleMailer implements Mailer {
  async sendSignInCode(email: string, code: string) {
    console.log(`\n  sign-in code for ${email}: ${code}\n`);
  }
}
