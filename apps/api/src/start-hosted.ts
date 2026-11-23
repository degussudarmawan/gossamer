import { ConfigError, loadConfig } from './config.js';

// A single executable command for hosts without a pre-deploy migration step.
// Keep migration and server startup sequential without relying on shell quoting.
async function startHosted() {
  loadConfig();
  await import('./db/migrate.js');
  if (process.exitCode) return;
  await import('./index.js');
}

startHosted().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : 'Hosted startup failed; check database configuration and migrations.');
  process.exitCode = 1;
});
