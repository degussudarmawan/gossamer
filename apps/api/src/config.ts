// Validate configuration before opening a database or accepting requests.
// Messages contain setting names only, so they can safely be displayed at startup.
export class ConfigError extends Error {}
export type Config = {
  production: boolean;
  port: number;
  dataDir: string;
  databaseUrl?: string;
  authSecret: string;
  mail: { mode: 'console' } | { mode: 'resend'; apiKey: string; from: string };
  publicOrigin?: string;
  webDist?: string;
  signInAllowlist?: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const authSecret = env.AUTH_SECRET || (production ? undefined : 'dev-only-secret');
  if (!authSecret || (production && authSecret.length < 32)) {
    throw new ConfigError('AUTH_SECRET must contain at least 32 characters in production');
  }
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError('PORT must be between 1 and 65535');
  const databaseUrl = env.DATABASE_URL || undefined;
  if (production && !databaseUrl) throw new ConfigError('DATABASE_URL is required in production');
  if (databaseUrl) {
    let valid = false;
    try { valid = ['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol); } catch { /* no secrets in error */ }
    if (!valid) throw new ConfigError('DATABASE_URL must be a PostgreSQL connection URL');
  }
  const mode = env.MAIL_MODE || (production ? 'resend' : 'console');
  if (mode !== 'console' && mode !== 'resend') throw new ConfigError('MAIL_MODE must be console or resend');
  if (production && mode !== 'resend') throw new ConfigError('Production cannot log sign-in codes: use MAIL_MODE=resend');
  let mail: Config['mail'] = { mode: 'console' };
  if (mode === 'resend') {
    if (!env.RESEND_API_KEY || !env.MAIL_FROM || /[\r\n]/.test(env.MAIL_FROM)) {
      throw new ConfigError('Resend requires RESEND_API_KEY and a valid MAIL_FROM');
    }
    mail = { mode, apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM };
  }
  const publicOrigin = env.PUBLIC_ORIGIN || undefined;
  if (production && !publicOrigin) throw new ConfigError('PUBLIC_ORIGIN is required in production');
  if (publicOrigin) {
    let valid = false;
    try {
      const url = new URL(publicOrigin);
      valid = url.origin === publicOrigin && ['http:', 'https:'].includes(url.protocol)
        && (!production || url.protocol === 'https:');
    } catch { /* validated below */ }
    if (!valid) throw new ConfigError('PUBLIC_ORIGIN must be an origin without a path or trailing slash (HTTPS in production)');
  }
  const invitedEmails = env.SIGN_IN_ALLOWLIST?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const signInAllowlist = invitedEmails?.length ? invitedEmails : undefined;
  // This first hosted release is an invited pilot; public launch needs shared abuse limits/moderation.
  if (production && !signInAllowlist?.length) throw new ConfigError('SIGN_IN_ALLOWLIST is required for the production pilot');
  return { production, port, dataDir: env.DATA_DIR || '.data/pg', databaseUrl, authSecret, mail,
    publicOrigin, webDist: env.WEB_DIST || undefined, signInAllowlist };
}
