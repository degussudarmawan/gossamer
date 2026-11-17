import { ApiError } from './ApiClient';

/**
 * Turns a failed request into a sentence a person can act on. `known` maps the
 * backend's short reasons (see ApiError.code) to words for this screen;
 * anything else gets a general apology. Unexpected failures are also logged.
 */
export function explain(err: unknown, known: Record<string, string> = {}): string {
  if (err instanceof ApiError) {
    const words = known[err.code];
    if (words) return words;
    if (err.code === 'invalid_input') return 'that doesn’t look right. have another look.';
    if (err.code === 'unauthorized') return 'you’ve been signed out. sign in again to carry on.';
  }
  console.error('request failed', err);
  return 'something went wrong on our side. try again in a moment.';
}
