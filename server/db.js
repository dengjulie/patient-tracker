import pg from 'pg';
import { STATUSES, ENTERED_IN_ERROR } from './constants.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings. By default pg converts
// them to JavaScript Dates at local midnight, which can shift a birthday by
// a day depending on the server's time zone.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// An idle connection can fail (e.g. Postgres restarts). Without a listener,
// Node treats that as an unhandled error and crashes the whole API. The pool
// already drops the broken connection and opens a new one when needed.
pool.on('error', (err) => console.error('Idle database connection error:', err.message));

const ALL_STATUS_CODES = [...STATUSES.map((s) => s.code), ENTERED_IN_ERROR];

// Audit actions, after ASTM E2147: "query" is a search that showed patients.
export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'query', 'login', 'login_failed', 'logout'];

// Creates the table if it doesn't exist yet. Called once at startup.
// - One column per field keeps queries simple; the API speaks the nested,
//   FHIR-shaped JSON, and toPatient/toRow translate between the two.
// - name_text is FHIR's HumanName.text: the full display name, kept for search.
// - unaccent lets a search for "jose" find "José".
export async function initDb() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS unaccent;

    CREATE TABLE IF NOT EXISTS patients (
      id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name_prefix    TEXT NOT NULL DEFAULT '',
      given_names    TEXT[] NOT NULL DEFAULT '{}',
      family_name    TEXT NOT NULL DEFAULT '',
      name_suffix    TEXT NOT NULL DEFAULT '',
      name_text      TEXT NOT NULL,
      preferred_name TEXT NOT NULL DEFAULT '',
      birth_date     DATE NOT NULL,
      status         TEXT NOT NULL CHECK (status IN (${ALL_STATUS_CODES.map((s) => `'${s}'`).join(', ')})),
      address_line1  TEXT NOT NULL,
      address_line2  TEXT NOT NULL DEFAULT '',
      city           TEXT NOT NULL,
      state          TEXT NOT NULL,
      postal_code    TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Matches the list's sort order, so a page can be read straight from the
    -- index instead of sorting every patient.
    CREATE INDEX IF NOT EXISTS patients_updated_at_idx ON patients (updated_at DESC, id DESC);

    -- Provider accounts. Created by script, never by sign-up (PRODUCT.md §7).
    -- Emails are stored lowercased so login is case-insensitive.
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Who did what to which patients, and when (PRODUCT.md §7). Append-only:
    -- the app never updates or deletes these rows. Holds patient ids, never
    -- names or search terms.
    CREATE TABLE IF NOT EXISTS audit_log (
      id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_id         INTEGER REFERENCES users (id),
      action          TEXT NOT NULL CHECK (action IN (${AUDIT_ACTIONS.map((a) => `'${a}'`).join(', ')})),
      patient_ids     INTEGER[] NOT NULL DEFAULT '{}',
      attempted_email TEXT,
      ip_address      TEXT
    );
  `);
}

// Runs `work` inside a transaction: if anything in it throws, nothing it
// wrote is saved. Used so a patient change and its audit entry succeed or
// fail together.
export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// `db` is the pool by default, or a transaction's client.
export async function recordAudit({ userId, action, patientIds = [], attemptedEmail = null, ipAddress }, db = pool) {
  await db.query(
    `INSERT INTO audit_log (user_id, action, patient_ids, attempted_email, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, patientIds, attemptedEmail, ipAddress]
  );
}

export async function createUser({ email, name, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name`,
    [email.toLowerCase(), name, passwordHash]
  );
  return rows[0];
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  return rows[0];
}

// Row (flat, snake_case) -> patient (FHIR-shaped JSON).
function toPatient(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: {
      text: row.name_text,
      prefix: row.name_prefix,
      given: row.given_names,
      family: row.family_name,
      suffix: row.name_suffix,
    },
    preferredName: row.preferred_name,
    birthDate: row.birth_date,
    status: row.status,
    address: {
      line: [row.address_line1, row.address_line2].filter(Boolean),
      city: row.city,
      state: row.state,
      postalCode: row.postal_code,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Patient (validated JSON) -> column values, in the order of COLUMNS below.
function toRow({ name, preferredName, birthDate, status, address }) {
  return [
    name.prefix,
    name.given,
    name.family,
    name.suffix,
    [name.prefix, ...name.given, name.family, name.suffix].filter(Boolean).join(' '),
    preferredName,
    birthDate,
    status,
    address.line[0],
    address.line[1] ?? '',
    address.city,
    address.state,
    address.postalCode,
  ];
}

const COLUMNS = [
  'name_prefix', 'given_names', 'family_name', 'name_suffix', 'name_text', 'preferred_name',
  'birth_date', 'status', 'address_line1', 'address_line2', 'city', 'state', 'postal_code',
];

// What search looks through: full name, preferred name, and the birth date
// in both ISO (1984-03-12) and US (03/12/1984) formats.
const SEARCHABLE = `unaccent(name_text || ' ' || preferred_name || ' ' ||
  to_char(birth_date, 'YYYY-MM-DD') || ' ' || to_char(birth_date, 'MM/DD/YYYY'))`;

// Returns one page of matching patients plus the total number of matches.
export async function listPatients({ search = '', status = '', page = 1, pageSize = 25 } = {}) {
  const params = [ENTERED_IN_ERROR];
  const conditions = ['status <> $1'];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  // Every word must match somewhere, so "maria garcia" finds "Maria Elena Garcia".
  // ILIKE ignores case (including accented letters); % and _ are escaped so
  // they're matched literally, not as wildcards.
  for (const word of search.split(/\s+/).filter(Boolean)) {
    params.push(`%${word.replace(/[\\%_]/g, '\\$&')}%`);
    conditions.push(`${SEARCHABLE} ILIKE unaccent($${params.length})`);
  }

  const where = conditions.join(' AND ');
  const { rows: countRows } = await pool.query(`SELECT count(*)::int AS total FROM patients WHERE ${where}`, params);

  const { rows } = await pool.query(
    `SELECT * FROM patients
     WHERE ${where}
     -- Most recently updated first (PRODUCT.md §6). id breaks ties, so the
     -- order is stable and no patient appears on two pages.
     ORDER BY updated_at DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { patients: rows.map(toPatient), total: countRows[0].total };
}

// The write functions below take an optional `db` (a transaction's client),
// so routes can write the patient and its audit entry together.

export async function createPatient(patient, db = pool) {
  const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(
    `INSERT INTO patients (${COLUMNS.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    toRow(patient)
  );
  return toPatient(rows[0]);
}

// Returns undefined if no patient has this id.
export async function updatePatient(id, patient, db = pool) {
  const assignments = COLUMNS.map((column, i) => `${column} = $${i + 1}`).join(', ');
  const { rows } = await db.query(
    `UPDATE patients SET ${assignments}, updated_at = now()
     WHERE id = $${COLUMNS.length + 1} RETURNING *`,
    [...toRow(patient), id]
  );
  return toPatient(rows[0]);
}

// "Delete" never erases a medical record. It marks it as entered in error,
// which hides it from the list (see PRODUCT.md §5).
export async function markEnteredInError(id, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE patients SET status = $1, updated_at = now() WHERE id = $2`,
    [ENTERED_IN_ERROR, id]
  );
  return rowCount > 0;
}
