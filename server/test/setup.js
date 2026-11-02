// Shared setup for the integration tests. Each test file gets its own
// throwaway database on the local Postgres, so tests never touch development
// data. The owner login (DATABASE_OWNER_URL) creates it and sets it up; the
// app then uses its own login (DATABASE_URL), as in production. It's created
// before db.js is imported, because db.js connects when it's loaded, and
// dropped when the file ends.
import pg from 'pg';

export const TEST_PASSWORD = 'test-password';

export async function useTestDatabase() {
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  const name = `patient_tracker_test_${process.pid}`;
  await adminQuery(ownerUrl, `DROP DATABASE IF EXISTS ${name}`);
  await adminQuery(ownerUrl, `CREATE DATABASE ${name}`);

  // Both logins, pointed at the test database.
  for (const key of ['DATABASE_OWNER_URL', 'DATABASE_URL']) {
    const url = new URL(process.env[key]);
    url.pathname = `/${name}`;
    process.env[key] = url.href;
  }
  process.env.SESSION_SECRET ??= 'test-session-secret';

  const db = await import('../db.js');
  await db.initDb();

  async function drop() {
    await db.closePools();
    await adminQuery(ownerUrl, `DROP DATABASE ${name} WITH (FORCE)`);
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
