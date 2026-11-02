// Starts the API. The routes are in app.js. The database is set up
// beforehand by `npm run migrate` (npm run dev does it for you).
import { assertRestrictedLogin } from './db.js';
import { app } from './app.js';

await assertRestrictedLogin();
const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
