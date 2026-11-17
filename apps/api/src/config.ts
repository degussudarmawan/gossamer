// Everything the server reads from its environment, checked once at startup.
export type Config = {
  production: boolean;
  port: number;
  /** Folder holding the database files. */
  dataDir: string;
  /** Server-only secret used when hashing sign-in codes. */
  authSecret: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  // A guessable default in production would let anyone who saw the database
  // work out sign-in codes, so there it must be set; locally a fixed one is fine.
  const authSecret = env.AUTH_SECRET ?? (production ? undefined : 'dev-only-secret');
  if (!authSecret) throw new Error('AUTH_SECRET must be set in production');

  return {
    production,
    port: Number(env.PORT) || 8787,
    dataDir: env.DATA_DIR ?? '.data/pg',
    authSecret,
  };
}
