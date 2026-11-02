// Sets up the database as the owner: tables, upgrades, the app login and its
// rights (see initDb in db.js). Safe to run again.
//
//   npm run migrate
import { initDb, closePools } from './db.js';

await initDb();
console.log('Database is up to date.');
await closePools();
