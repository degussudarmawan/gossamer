import type { ApiClient } from './ApiClient';

export type User = { email: string };

/** The backend's sign-in endpoints, as plain methods. Screens call these, never URLs. */
export class AuthApi {
  constructor(private readonly http: ApiClient) {}

  /** Who this browser is signed in as, or null. */
  async me(): Promise<User | null> {
    return (await this.http.get<{ user: User | null }>('/auth/me')).user;
  }

  async requestCode(email: string): Promise<void> {
    await this.http.post('/auth/request-code', { email });
  }

  /** Signs in. Throws ApiError("invalid_code") if the code is wrong, expired or used. */
  async verifyCode(email: string, code: string): Promise<User> {
    return (await this.http.post<{ user: User }>('/auth/verify-code', { email, code })).user;
  }

  async signOut(): Promise<void> {
    await this.http.post('/auth/sign-out');
  }
}
