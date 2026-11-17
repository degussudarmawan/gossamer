import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from './lib/AuthApi';
import { authApi } from './services';

type Session = {
  /** null while signed out. Also null while `loading`, before the server has answered. */
  user: User | null;
  loading: boolean;
  signedIn: (user: User) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

// Asks the server once, on load, who (if anyone) this browser is signed in as,
// and keeps that answer for the whole app.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    authApi
      .me()
      .then((found) => alive && setUser(found))
      // Can't reach the server: carry on as signed out, and leave a trace for whoever is debugging.
      .catch((err: unknown) => console.error('could not check the session', err))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await authApi.signOut();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signedIn: setUser, signOut }), [user, loading, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
