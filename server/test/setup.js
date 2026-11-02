// Shared setup for the integration tests. Each test file gets its own
// throwaway database on the local Postgres (from .env's DATABASE_URL), so
// tests never touch development data. It's created before db.js is imported,
// because db.js connects when it's loaded, and dropped when the file ends.
import pg from 'pg';

export const TEST_PASSWORD = 'test-password';

export async function useTestDatabase() {
  const serverUrl = process.env.DATABASE_URL;
  const name = `patient_tracker_test_${process.pid}`;
  await adminQuery(serverUrl, `DROP DATABASE IF EXISTS ${name}`);
  await adminQuery(serverUrl, `CREATE DATABASE ${name}`);

  const testUrl = new URL(serverUrl);
  testUrl.pathname = `/${name}`;
  process.env.DATABASE_URL = testUrl.href;
  process.env.SESSION_SECRET ??= 'test-session-secret';

  const db = await import('../db.js');
  await db.initDb();

  async function drop() {
    await db.pool.end();
    await adminQuery(serverUrl, `DROP DATABASE ${name} WITH (FORCE)`);
  }
  return { db, drop };
}

async function adminQuery(url, sql) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

// A valid patient, in the validated shape db.js stores.
export function samplePatient({ given = ['Test'], family = 'Patient', birthDate = '1980-01-01', street = '1 Main St' } = {}) {
  return {
    name: { prefix: '', given, family, suffix: '' },
    preferredName: '',
    birthDate,
    status: 'active',
    address: { line: [street], city: 'Boston', state: 'MA', postalCode: '02134' },
  };
}
