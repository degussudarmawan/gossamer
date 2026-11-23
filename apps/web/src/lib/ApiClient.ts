export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The backend's short reason, e.g. "invalid_code". "unknown" if it sent none. */
    readonly code: string,
  ) {
    super(`api ${status}: ${code}`);
  }
}

/**
 * The one place the web app makes HTTP requests. Everything goes to the same
 * origin, so the session cookie rides along without any extra setup.
 * Any non-2xx answer becomes a thrown ApiError.
 */
export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  get<T>(path: string): Promise<T> {
    return this.send<T>(path);
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.sendJson<T>('POST', path, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.sendJson<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.send<T>(path, { method: 'DELETE' });
  }

  private sendJson<T>(method: string, path: string, body: unknown): Promise<T> {
    return this.send<T>(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async send<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const code = (data as { error?: unknown } | null)?.error;
      throw new ApiError(res.status, typeof code === 'string' ? code : 'unknown');
    }
    return data as T;
  }
}
