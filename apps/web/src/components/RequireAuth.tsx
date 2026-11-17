import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../session';

/**
 * Wraps a screen that only makes sense signed in. Signed-out visitors are sent
 * to sign in and brought back afterwards. This is a convenience, not security:
 * the backend refuses every request that lacks a session regardless.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return null;
  // Only the path is carried over. Anything after # (an invite code) is never put in a URL we build.
  if (!user) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}
