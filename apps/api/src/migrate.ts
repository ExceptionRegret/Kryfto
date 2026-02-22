import { runMigrations } from './db/client.js';

runMigrations()
  .then(() => {
    process.stdout.write('Migrations complete\n');
  })
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });