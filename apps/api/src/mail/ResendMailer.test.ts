import { expect, it, vi } from 'vitest';
import { MailDeliveryError, ResendMailer } from './ResendMailer.js';

it('submits the code to Resend server-side with a bounded request and idempotency key', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'mail-id' })));
  await new ResendMailer('fake-key', 'Gossamer <login@example.com>', fetcher).sendSignInCode('friend@example.com', '012345');
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://api.resend.com/emails');
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  const headers = options!.headers as Record<string, string>;
  expect(headers.Authorization).toBe('Bearer fake-key'); expect(headers['Idempotency-Key']).toBeTruthy();
  const body = JSON.parse(options!.body as string);
  expect(body.to).toEqual(['friend@example.com']); expect(body.text).toContain('012345');
});
it('returns a safe error on rejection, invalid response or network failure, without logging secrets', async () => {
  const logger = vi.spyOn(console, 'log');
  try {
    for (const response of [new Response('secret provider body', { status: 403 }), new Response('{}'), new Response('not-json')]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(new ResendMailer('fake-key', 'login@example.com', fetcher).sendSignInCode('friend@example.com', '012345'))
        .rejects.toThrow(MailDeliveryError);
    }
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret request data'));
    await expect(new ResendMailer('fake-key', 'login@example.com', fetcher).sendSignInCode('friend@example.com', '012345'))
      .rejects.toThrow('Sign-in email could not be sent');
    expect(logger).not.toHaveBeenCalled();
  } finally { logger.mockRestore(); }
});
