import pg from 'pg';
import { STATUSES, ENTERED_IN_ERROR } from './constants.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings. By default pg converts
// them to JavaScript Dates at local midnight, which can shift a birthday by
// a day depending on the server's time zone.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const ALL_STATUS_CODES = [...STATUSES.map((s) => s.code), ENTERED_IN_ERROR];

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

    -- Provider accounts. Created by script, never by sign-up (PRODUCT.md §7).
    -- Emails are stored lowercased so login is case-insensitive.
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
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

export async function listPatients({ search = '', status = '' } = {}) {
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

  const { rows } = await pool.query(
    `SELECT * FROM patients
     WHERE ${conditions.join(' AND ')}
     -- Sort by family name; patients with only a given name sort by that.
     ORDER BY lower(COALESCE(NULLIF(family_name, ''), name_text)), name_text`,
    params
  );
  return rows.map(toPatient);
}

export async function createPatient(patient) {
  const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO patients (${COLUMNS.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    toRow(patient)
  );
  return toPatient(rows[0]);
}

// Returns undefined if no patient has this id.
export async function updatePatient(id, patient) {
  const assignments = COLUMNS.map((column, i) => `${column} = $${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE patients SET ${assignments}, updated_at = now()
     WHERE id = $${COLUMNS.length + 1} RETURNING *`,
    [...toRow(patient), id]
  );
  return toPatient(rows[0]);
}

// "Delete" never erases a medical record. It marks it as entered in error,
// which hides it from the list (see PRODUCT.md §5).
export async function markEnteredInError(id) {
  const { rowCount } = await pool.query(
    `UPDATE patients SET status = $1, updated_at = now() WHERE id = $2`,
    [ENTERED_IN_ERROR, id]
  );
  return rowCount > 0;
}
