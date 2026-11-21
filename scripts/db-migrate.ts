import { config } from '../src/config';
import { openDb } from '../src/db';

openDb(config.databaseUrl).then(
  () => console.log(`db:migrate: migrations applied to ${config.databaseUrl}`),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
