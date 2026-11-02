// Starts the API: prepares the database, then listens. The routes are in app.js.
import { initDb } from './db.js';
import { app } from './app.js';

await initDb();
const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
