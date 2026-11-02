import pg from 'pg';
import { STATUSES, ENTERED_IN_ERROR } from './constants.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings. By default pg converts
// them to JavaScript Dates at local midnight, which can shift a birthday by
// a day depending on the server's time zone.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

// Two database logins (ARCHITECTURE.md → Database logins):
// - DATABASE_URL is the app's own login, used for every request. It isn't a
//   superuser and doesn't own the tables, so row-level security applies to
//   all of its queries, and it has only the rights the app needs (see
//   initDb). A stolen server config can't erase records or the audit log.
// - DATABASE_OWNER_URL owns the tables. It's used only to set up the schema
//   (npm run migrate) and by the admin scripts (seed, create-user).
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// An idle connection can fail (e.g. Postgres restarts). Without a listener,
// Node treats that as an unhandled error and crashes the whole API. The pool
// already drops the broken connection and opens a new one when needed.
pool.on('error', (err) => console.error('Idle database connection error:', err.message));

// Opened only when first needed, so the running server never connects as
// the owner.
let ownerPool;
function owner() {
  ownerPool ??= new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  return ownerPool;
}

// The app login's name, plus its name and password quoted for SQL, from
// DATABASE_URL. It must be a different login from the owner's.
function appLogin() {
  const url = new URL(process.env.DATABASE_URL);
  const name = decodeURIComponent(url.username);
  if (name === decodeURIComponent(new URL(process.env.DATABASE_OWNER_URL).username)) {
    throw new Error('DATABASE_URL and DATABASE_OWNER_URL must use different logins (see README → Setup).');
  }
  return { name, role: pg.escapeIdentifier(name), password: pg.escapeLiteral(decodeURIComponent(url.password)) };
}

// Closes both connection pools, so a script can exit.
export async function closePools() {
  await pool.end();
  await ownerPool?.end();
}

// Refuses to run the API as a login that would bypass row-level security:
// a superuser, or the owner of the patients table. Called at startup, so a
// misconfigured DATABASE_URL stops the server instead of silently exposing
// every practice's patients.
export async function assertRestrictedLogin() {
  const { rows } = await pool.query(
    `SELECT rolsuper, pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE relname = 'patients'), 'MEMBER') AS owns
     FROM pg_roles WHERE rolname = current_user`
  );
  if (rows[0].rolsuper || rows[0].owns) {
    throw new Error('DATABASE_URL must be the app login, not a superuser or the table owner (see README → Setup).');
  }
}

const ALL_STATUS_CODES = [...STATUSES.map((s) => s.code), ENTERED_IN_ERROR];

// Audit actions, after ASTM E2147: "query" is a search that showed patients;
// "read" is opening one patient's full record.
export const AUDIT_ACTIONS = ['create', 'read', 'update', 'delete', 'query', 'login', 'login_failed', 'logout'];

// The practice existing data joins when a database from before practices is
// upgraded (see initDb), and the seed's main demo practice.
export const DEFAULT_PRACTICE = 'Demo Practice';

// Sets up the database as the owner: creates the tables if they don't exist,
// upgrades older ones, and creates the app login with only the rights it
// needs. Run by `npm run migrate` (and before seeding and tests); safe to
// run again.
// - One column per field keeps queries simple; the API speaks the nested,
//   FHIR-shaped JSON, and toPatient/toRow translate between the two.
// - name_text is FHIR's HumanName.text: the full display name, kept for search.
// - unaccent lets a search for "jose" find "José".
export async function initDb() {
  const db = owner();
  const app = appLogin();
  const { rowCount } = await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [app.name]);
  // Created, or updated to match .env, from DATABASE_URL's user and password.
  await db.query(`${rowCount ? 'ALTER' : 'CREATE'} ROLE ${app.role} LOGIN PASSWORD ${app.password}`);

  await db.query(`
    CREATE EXTENSION IF NOT EXISTS unaccent;

    -- Each provider and each patient belongs to one practice, and providers
    -- see only their own practice's patients (PRODUCT.md §7).
    CREATE TABLE IF NOT EXISTS practices (
      id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS patients (
      id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      practice_id    INTEGER NOT NULL REFERENCES practices (id),
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
      practice_id   INTEGER NOT NULL REFERENCES practices (id),
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
      practice_id     INTEGER REFERENCES practices (id),
      user_id         INTEGER REFERENCES users (id),
      action          TEXT NOT NULL,
      patient_ids     INTEGER[] NOT NULL DEFAULT '{}',
      attempted_email TEXT,
      ip_address      TEXT
    );
    -- For each provider's recent patients (listRecentPatients).
    CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, occurred_at);

    -- Upgrades a database from before practices: adds the columns, and puts
    -- every existing patient and provider in one practice. Does nothing on a
    -- new or already-upgraded database.
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS practice_id INTEGER REFERENCES practices (id);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS practice_id INTEGER REFERENCES practices (id);
    ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS practice_id INTEGER REFERENCES practices (id);
    INSERT INTO practices (name) SELECT '${DEFAULT_PRACTICE}'
      WHERE EXISTS (SELECT 1 FROM patients WHERE practice_id IS NULL)
         OR EXISTS (SELECT 1 FROM users WHERE practice_id IS NULL)
      ON CONFLICT (name) DO NOTHING;
    UPDATE patients SET practice_id = (SELECT id FROM practices WHERE name = '${DEFAULT_PRACTICE}')
      WHERE practice_id IS NULL;
    UPDATE users SET practice_id = (SELECT id FROM practices WHERE name = '${DEFAULT_PRACTICE}')
      WHERE practice_id IS NULL;
    UPDATE audit_log SET practice_id = users.practice_id FROM users
      WHERE audit_log.user_id = users.id AND audit_log.practice_id IS NULL;
    ALTER TABLE patients ALTER COLUMN practice_id SET NOT NULL;
    ALTER TABLE users ALTER COLUMN practice_id SET NOT NULL;

    -- Single names now go in the last-name field (PRODUCT.md §1). Moves the
    -- ones saved as a first name before; the display name doesn't change.
    UPDATE patients SET family_name = given_names[1], given_names = '{}'
      WHERE family_name = '' AND cardinality(given_names) = 1;

    -- Matches the list's filter and sort order, so a page can be read
    -- straight from the index instead of sorting the practice's patients.
    DROP INDEX IF EXISTS patients_updated_at_idx;
    CREATE INDEX IF NOT EXISTS patients_practice_updated_idx
      ON patients (practice_id, updated_at DESC, id DESC);

    -- Sessions (connect-pg-simple's table, created here because the app
    -- login can't create tables).
    CREATE TABLE IF NOT EXISTS session (
      sid    VARCHAR NOT NULL PRIMARY KEY,
      sess   JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);

    -- The app login's rights: only what the app does. No DELETE on patients
    -- (records are never erased) and only adding and reading the audit log
    -- (it's append-only), so a compromised server can't do either. Users and
    -- practices are read-only: accounts come from the admin scripts.
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${app.role};
    GRANT SELECT, INSERT, UPDATE ON patients TO ${app.role};
    GRANT SELECT, INSERT ON audit_log TO ${app.role};
    GRANT SELECT ON users, practices TO ${app.role};
    GRANT SELECT, INSERT, UPDATE, DELETE ON session TO ${app.role};

    -- Row-level security: the app login sees and writes only patients of the
    -- practice set for the transaction (app.practice_id; see withPractice).
    -- With no practice set, it sees none. This holds even if a query forgets
    -- to filter by practice. The owner and superusers bypass it, which is why
    -- the app has its own login.
    ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS own_practice ON patients;
    -- NULLIF: after a transaction ends the setting reads as '' (not NULL),
    -- which can't be cast to an integer.
    CREATE POLICY own_practice ON patients
      USING (practice_id = NULLIF(current_setting('app.practice_id', true), '')::int)
      WITH CHECK (practice_id = NULLIF(current_setting('app.practice_id', true), '')::int);

    -- Recreated on every start, so a database made before an action was
    -- added to AUDIT_ACTIONS accepts it too.
    ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
      CHECK (action IN (${AUDIT_ACTIONS.map((a) => `'${a}'`).join(', ')}));
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

// Runs `work` in a transaction scoped to one practice: app.practice_id is set
// for the transaction only, so row-level security limits every patient query
// to that practice. `work` gets a `db` whose `practiceId` the queries below also
// filter on explicitly; either check alone keeps other practices' patients
// out. Every patient query goes through here (the functions below take this
// `db` and have no default), so none can run unscoped by accident.
export async function withPractice(practiceId, work) {
  if (!Number.isInteger(practiceId)) throw new Error('withPractice needs a practice id');
  return transaction(async (client) => {
    await client.query(`SELECT set_config('app.practice_id', $1, true)`, [String(practiceId)]);
    return work({ query: (text, params) => client.query(text, params), practiceId });
  });
}

// `db` is the pool by default, or a transaction's client.
export async function recordAudit(
  { practiceId = null, userId, action, patientIds = [], attemptedEmail = null, ipAddress },
  db = pool
) {
  await db.query(
    `INSERT INTO audit_log (practice_id, user_id, action, patient_ids, attempted_email, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [practiceId, userId, action, patientIds, attemptedEmail, ipAddress]
  );
}

// The practice with this name, created if it doesn't exist yet, plus
// whether it was just created. For the seed and create-user scripts (as the
// owner: the app login can't create practices); there's no practice sign-up.
export async function findOrCreatePractice(name) {
  const inserted = await owner().query(
    `INSERT INTO practices (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *`,
    [name]
  );
  if (inserted.rows[0]) return { practice: inserted.rows[0], created: true };
  const { rows } = await owner().query(`SELECT * FROM practices WHERE name = $1`, [name]);
  return { practice: rows[0], created: false };
}

// As the owner: the app login can't create accounts (no sign-up).
export async function createUser({ practiceId, email, name, passwordHash }) {
  const { rows } = await owner().query(
    `INSERT INTO users (practice_id, email, name, password_hash) VALUES ($1, $2, $3, $4)
     RETURNING id, email, name`,
    [practiceId, email.toLowerCase(), name, passwordHash]
  );
  return rows[0];
}

// Includes the practice's name, for showing which practice is logged in.
export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT users.*, practices.name AS practice_name
     FROM users JOIN practices ON practices.id = users.practice_id
     WHERE users.email = $1`,
    [email.toLowerCase()]
  );
  return rows[0];
}

// Audit log entries, newest first, for reviewing them (audit-log.js). As the
// owner, so it sees every practice; the app login only reads its own
// provider's entries. Every filter is optional.
export async function listAuditEntries({ patientId, email, practice, action, since, limit = 50 } = {}) {
  const params = [];
  const conditions = [];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };
  if (patientId) add('? = ANY (a.patient_ids)', patientId);
  if (email) add('lower(coalesce(u.email, a.attempted_email)) = lower(?)', email);
  // Exact name, any case: a pattern (ILIKE) could match, and mix in, other
  // practices' entries.
  if (practice) add('lower(p.name) = lower(?)', practice);
  if (action) add('a.action = ?', action);
  if (since) add('a.occurred_at >= ?::date', since);
  params.push(limit);

  const { rows } = await owner().query(
    `SELECT a.occurred_at, p.name AS practice, coalesce(u.email, a.attempted_email) AS email,
            a.action, a.patient_ids, a.ip_address
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN practices p ON p.id = a.practice_id
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY a.id DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
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

// Every function below takes the `db` from withPractice and works only on
// that practice's patients (also enforced by row-level security).

// Returns one page of matching patients plus the total number of matches.
export async function listPatients(db, { search = '', status = '', page = 1, pageSize = 25 } = {}) {
  const params = [db.practiceId, ENTERED_IN_ERROR];
  const conditions = ['practice_id = $1', 'status <> $2'];

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
  const { rows: countRows } = await db.query(`SELECT count(*)::int AS total FROM patients WHERE ${where}`, params);

  const { rows } = await db.query(
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

export async function createPatient(db, patient) {
  const placeholders = COLUMNS.map((_, i) => `$${i + 2}`).join(', ');
  const { rows } = await db.query(
    `INSERT INTO patients (practice_id, ${COLUMNS.join(', ')}) VALUES ($1, ${placeholders}) RETURNING *`,
    [db.practiceId, ...toRow(patient)]
  );
  return toPatient(rows[0]);
}

// Returns undefined if no patient has this id, if it was entered in error
// (a deleted patient can't be edited back to life), or if `ifUpdatedAt` is
// given and the patient has been saved since then (someone else's edit).
// updated_at is compared to the millisecond because that's all the API's
// JSON timestamps carry; Postgres stores microseconds.
export async function updatePatient(db, id, patient, ifUpdatedAt) {
  const n = COLUMNS.length;
  const assignments = COLUMNS.map((column, i) => `${column} = $${i + 1}`).join(', ');
  const { rows } = await db.query(
    `UPDATE patients SET ${assignments}, updated_at = now()
     WHERE id = $${n + 1}
       AND practice_id = $${n + 2}
       AND status <> $${n + 3}
       AND ($${n + 4}::timestamptz IS NULL OR date_trunc('milliseconds', updated_at) = $${n + 4})
     RETURNING *`,
    [...toRow(patient), id, db.practiceId, ENTERED_IN_ERROR, ifUpdatedAt ?? null]
  );
  return toPatient(rows[0]);
}

// The `limit` patients this provider most recently opened, added or edited
// in the last `days` days, the most recent first, each with `viewedAt`: when
// that last happened. Built from their own audit entries, which already
// record exactly this.
export async function listRecentPatients(db, userId, { limit = 10, days = 30 } = {}) {
  const { rows } = await db.query(
    `SELECT patients.*, activity.last_activity FROM patients
     JOIN (
       SELECT patient_id, max(occurred_at) AS last_activity
       FROM audit_log, unnest(patient_ids) AS patient_id
       WHERE user_id = $1
         AND action IN ('read', 'create', 'update')
         AND occurred_at > now() - make_interval(days => $2::int)
       GROUP BY patient_id
     ) activity ON activity.patient_id = patients.id
     WHERE patients.practice_id = $3 AND patients.status <> $4
     ORDER BY activity.last_activity DESC, patients.id DESC
     LIMIT $5`,
    [userId, days, db.practiceId, ENTERED_IN_ERROR, limit]
  );
  return rows.map((row) => ({ ...toPatient(row), viewedAt: row.last_activity }));
}

// One patient, unless it was entered in error (hidden everywhere, like the list).
export async function findPatient(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM patients WHERE id = $1 AND practice_id = $2 AND status <> $3`,
    [id, db.practiceId, ENTERED_IN_ERROR]
  );
  return toPatient(rows[0]);
}

// Whether a patient (not entered in error) has this id.
export async function patientExists(db, id) {
  return Boolean(await findPatient(db, id));
}

// Current patients (not entered in error) born on any of these dates. The CSV
// import uses this to find patients a file may already contain.
export async function findPatientsBornOn(db, birthDates) {
  const { rows } = await db.query(
    `SELECT * FROM patients WHERE birth_date = ANY($1::date[]) AND practice_id = $2 AND status <> $3`,
    [birthDates, db.practiceId, ENTERED_IN_ERROR]
  );
  return rows.map(toPatient);
}

// Only seed.js uses this, to spread fake patients' history over time so the
// demo list (sorted by updated_at) looks like real use.
export async function setPatientTimestamps(db, id, { createdAt, updatedAt }) {
  await db.query(
    `UPDATE patients SET created_at = $1, updated_at = $2 WHERE id = $3 AND practice_id = $4`,
    [createdAt, updatedAt, id, db.practiceId]
  );
}

// "Delete" never erases a medical record. It marks it as entered in error,
// which hides it from the list (see PRODUCT.md §5). Returns false if there's
// no such patient or it was already deleted.
export async function markEnteredInError(db, id) {
  const { rowCount } = await db.query(
    `UPDATE patients SET status = $1, updated_at = now() WHERE id = $2 AND practice_id = $3 AND status <> $1`,
    [ENTERED_IN_ERROR, id, db.practiceId]
  );
  return rowCount > 0;
}
