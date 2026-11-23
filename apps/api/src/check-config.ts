import { ConfigError, loadConfig } from './config.js';

try {
  const config = loadConfig();
  console.log(`Configuration valid: ${config.production ? 'production' : 'local development'}`);
  console.log(`Port: ${config.port}`);
  console.log(`Database: ${config.databaseUrl ? 'network PostgreSQL (URL hidden)' : 'local PGlite'}`);
  console.log(`Email: ${config.mail.mode === 'resend' ? 'Resend configured (key and sender hidden)' : 'terminal codes only'}`);
  console.log(`Sign-in: ${config.signInAllowlist ? 'invited emails only' : 'public (email verification required)'}`);
  console.log('Configuration check only: no database connection or email was attempted.');
} catch (error: unknown) {
  console.error(error instanceof ConfigError ? error.message : 'Configuration could not be checked');
  process.exitCode = 1;
}
