import Database from 'better-sqlite3';
import { STATUSES, ENTERED_IN_ERROR } from './constants.js';

// The database is a single file next to this module. It's created on first run.
const db = new Database(new URL('./patients.db', import.meta.url).pathname);

const ALL_STATUS_CODES = [...STATUSES.map((s) => s.code), ENTERED_IN_ERROR];

// The table is flat (one column per field) so it's easy to query. The API
// speaks the nested, FHIR-shaped JSON; toPatient/toRow translate between them.
// `nameText` is FHIR's HumanName.text: the full display name, kept for search.
db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    namePrefix    TEXT NOT NULL DEFAULT '',
    givenNames    TEXT NOT NULL DEFAULT '[]',
    familyName    TEXT NOT NULL DEFAULT '',
    nameSuffix    TEXT NOT NULL DEFAULT '',
    nameText      TEXT NOT NULL,
    preferredName TEXT NOT NULL DEFAULT '',
    birthDate     TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN (${ALL_STATUS_CODES.map((s) => `'${s}'`).join(', ')})),
    addressLine1  TEXT NOT NULL,
    addressLine2  TEXT NOT NULL DEFAULT '',
    city          TEXT NOT NULL,
    state         TEXT NOT NULL,
    postalCode    TEXT NOT NULL,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt     TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Row (flat) -> patient (FHIR-shaped JSON).
function toPatient(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: {
      text: row.nameText,
      prefix: row.namePrefix,
      given: JSON.parse(row.givenNames),
      family: row.familyName,
      suffix: row.nameSuffix,
    },
    preferredName: row.preferredName,
    birthDate: row.birthDate,
    status: row.status,
    address: {
      line: [row.addressLine1, row.addressLine2].filter(Boolean),
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Patient (validated JSON) -> row parameters.
function toRow({ name, preferredName, birthDate, status, address }) {
  return {
    namePrefix: name.prefix,
    givenNames: JSON.stringify(name.given),
    familyName: name.family,
    nameSuffix: name.suffix,
    nameText: [name.prefix, ...name.given, name.family, name.suffix].filter(Boolean).join(' '),
    preferredName,
    birthDate,
    status,
    addressLine1: address.line[0],
    addressLine2: address.line[1] ?? '',
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
  };
}

// What search looks through: full name, preferred name, and the birth date
// in both ISO (1984-03-12) and US (03/12/1984) formats.
const SEARCHABLE = `(nameText || ' ' || preferredName || ' ' || birthDate || ' ' || strftime('%m/%d/%Y', birthDate))`;

export function listPatients({ search = '', status = '' } = {}) {
  // Every word must match somewhere, so "maria garcia" finds "Maria Elena Garcia".
  // % and _ are escaped so they're matched literally, not as LIKE wildcards.
  const words = search.split(/\s+/).filter(Boolean);
  const params = { status, enteredInError: ENTERED_IN_ERROR };
  const wordClauses = words.map((word, i) => {
    params[`w${i}`] = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
    return `AND ${SEARCHABLE} LIKE @w${i} ESCAPE '\\'`;
  });

  return db
    .prepare(
      `SELECT * FROM patients
       WHERE status != @enteredInError
         AND (@status = '' OR status = @status)
         ${wordClauses.join('\n         ')}
       -- Sort by family name; patients with only a given name sort by that.
       ORDER BY COALESCE(NULLIF(familyName, ''), nameText) COLLATE NOCASE, nameText`
    )
    .all(params)
    .map(toPatient);
}

export function getPatient(id) {
  return toPatient(db.prepare('SELECT * FROM patients WHERE id = ?').get(id));
}

export function createPatient(patient) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO patients (namePrefix, givenNames, familyName, nameSuffix, nameText, preferredName,
                             birthDate, status, addressLine1, addressLine2, city, state, postalCode)
       VALUES (@namePrefix, @givenNames, @familyName, @nameSuffix, @nameText, @preferredName,
               @birthDate, @status, @addressLine1, @addressLine2, @city, @state, @postalCode)`
    )
    .run(toRow(patient));
  return getPatient(lastInsertRowid);
}

export function updatePatient(id, patient) {
  const { changes } = db
    .prepare(
      `UPDATE patients SET
         namePrefix = @namePrefix, givenNames = @givenNames, familyName = @familyName,
         nameSuffix = @nameSuffix, nameText = @nameText, preferredName = @preferredName,
         birthDate = @birthDate, status = @status,
         addressLine1 = @addressLine1, addressLine2 = @addressLine2,
         city = @city, state = @state, postalCode = @postalCode,
         updatedAt = datetime('now')
       WHERE id = @id`
    )
    .run({ ...toRow(patient), id });
  return changes ? getPatient(id) : undefined;
}

// "Delete" never erases a medical record. It marks it as entered in error,
// which hides it from the list (see PRODUCT.md §5).
export function markEnteredInError(id) {
  const { changes } = db
    .prepare(`UPDATE patients SET status = ?, updatedAt = datetime('now') WHERE id = ?`)
    .run(ENTERED_IN_ERROR, id);
  return changes > 0;
}
