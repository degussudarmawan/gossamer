import { useEffect, useState } from 'react';

type Status = 'checking' | 'connected' | 'unreachable';

// Development aid: shows whether the web app can reach the backend through the
// Vite proxy. Rendered only in dev (see Home), never in a production build.
export default function ApiStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((res) => setStatus(res.ok ? 'connected' : 'unreachable'))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('api health check failed', err);
          setStatus('unreachable');
        }
      });
    return () => controller.abort();
  }, []);

  return <span>api · {status}</span>;
}
