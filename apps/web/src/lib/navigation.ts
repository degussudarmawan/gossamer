/** Where to go after signing in: the `next` path if it is one of ours, otherwise the rooms list. */
export function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  // must be a path on this site: starts with one slash, not two (which would be another host)
  return next && /^\/(?!\/)/.test(next) ? next : '/rooms';
}

// An invite code waiting to be used. It arrives after the # in a link, which
// browsers never send to a server. We lift it out of the address bar at once
// and hold it here, for this tab only, so it survives a detour through sign-in
// without ever appearing in a URL we build.
const INVITE_KEY = 'pendingInvite';

export const pendingInvite = {
  take(): string {
    try {
      return sessionStorage.getItem(INVITE_KEY) ?? '';
    } catch {
      return ''; // storage blocked: the person can still type the code in
    }
  },
  keep(code: string) {
    try {
      sessionStorage.setItem(INVITE_KEY, code);
    } catch {
      // storage blocked: the code lives only in the page's memory
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(INVITE_KEY);
    } catch {
      // nothing was stored
    }
  },
};
