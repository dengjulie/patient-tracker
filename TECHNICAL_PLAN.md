# Patient Tracker: Technical Plan

How the product decisions in [PRODUCT.md](PRODUCT.md) are built.
The guiding rule is **the simplest thing that's correct**: well-known
libraries, few moving parts, and code a new reader can follow.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Front end | **React** (Vite) | Widely known; fast dev server; almost no config. |
| Back end | **Express 5** | The smallest well-known Node HTTP framework. v5 forwards errors from async handlers automatically. |
| Database | **PostgreSQL 17** via `pg`, run with Docker Compose | Real `DATE` and list (`TEXT[]`) types; `unaccent` for accent-insensitive name search; `pg_trgm` indexes when we reach hospital scale. It's what production health systems run. |
| Sessions | **express-session** + **connect-pg-simple** | The standard Express session library, with sessions stored in our existing Postgres (no Redis). |
| Passwords | Node's built-in **scrypt** | A memory-hard password hash that ships with Node, so no extra dependency. |
| Validation | **Zod** | Declares each field rule once, and produces readable per-field error messages. |

## Layout

```
patient-tracker/
├── PRODUCT.md          product decisions and reasoning
├── TECHNICAL_PLAN.md   this file
├── docker-compose.yml  local Postgres (host port 5433)
├── server/
│   ├── .env.example    DATABASE_URL; copy to .env
│   ├── audit.js        builds an audit entry from the request
│   ├── auth.js         password hashing, sessions, login/logout, requireAuth
│   ├── constants.js    status list (FHIR) and US state list
│   ├── create-user.js  admin script: create a provider account
│   ├── db.js           schema + every SQL query (routes contain no SQL)
│   ├── index.js        Express routes + Zod validation
│   └── seed.js         sample patients covering the edge cases
└── client/             (piece 2)
```

## Data model: FHIR-shaped, not a FHIR server

The API's JSON uses FHIR's **field names and structure** (`name.given[]`,
`name.family`, `birthDate`, `address.line[]`, `postalCode`, and the
`EpisodeOfCare` status codes). That way anyone who knows FHIR can read it, and
it maps cleanly if we ever need to exchange data with an EHR.

We deliberately do **not** build a conformant FHIR server, which would mean
`resourceType`, a separate `EpisodeOfCare` resource, Bundles and search
parameters. That is a lot of machinery we don't need.

| FHIR | Ours | Simplification |
| --- | --- | --- |
| `Patient.name[]`, a list of HumanNames | one `name` + a `preferredName` string | Covers official + preferred, the only two uses we support. |
| `HumanName.prefix[]` / `suffix[]` (lists) | single strings | Patients rarely have more than one. |
| `EpisodeOfCare.status` (its own resource) | `status` directly on the patient | One episode per patient for now. |
| `Address.country`, `use`, `period` | omitted | US only (PRODUCT.md §3). |

Example patient:

```json
{
  "id": 2,
  "name": {
    "text": "Robert James Okafor Jr.",
    "prefix": "",
    "given": ["Robert", "James"],
    "family": "Okafor",
    "suffix": "Jr."
  },
  "preferredName": "Bobby",
  "birthDate": "1991-07-28",
  "status": "planned",
  "address": { "line": ["45 Elm Ave"], "city": "Austin", "state": "TX", "postalCode": "78701" },
  "createdAt": "2026-10-24T16:35:45.000Z",
  "updatedAt": "2026-10-24T16:35:45.000Z"
}
```

`name.text` (FHIR's display name) is **computed by the server** from the other
name parts. Clients never send it.

## Database

**Why Postgres over SQLite:** we started on SQLite (no setup at all). We
switched because three product decisions need what Postgres has built in:
- **Dates:** a real `DATE` type for birth dates.
- **Search on names from every culture:** SQLite's `LIKE` only ignores case
  for A–Z, so "josé" wouldn't find "JOSÉ". Postgres `ILIKE` with `unaccent`
  matches both, and also lets "jose" find "José".
- **Hospital scale:** a path to fast search over large tables via `pg_trgm`
  indexes.

The cost is that reviewers need Docker (`docker compose up -d`) or a local
Postgres install.

- **One flat `patients` table**, one column per field, in `snake_case`
  (the Postgres convention).
  - `given_names` is `TEXT[]`, a native Postgres list.
  - `name_text` (the full display name) is stored so search can match it.
  - The address is stored in full as five columns: line 1, line 2, city,
    state, postal code. Epic's reporting database stores the patient's
    current address the same way. A separate addresses table (for multiple
    addresses or history, as in OpenMRS/FHIR) is on the Later list.
- **Translation:** `toPatient` / `toRow` in `db.js` convert between flat
  `snake_case` rows and the nested camelCase JSON. This is the only
  translation layer.
- **Status constraint:** a `CHECK` constraint on `status` means the database
  itself rejects invalid codes, as a backstop behind the API's own check.
- **Dates:**
  - `birth_date` is a `DATE`. `pg` is told to return it as a plain
    `YYYY-MM-DD` string. Its default turns it into a JavaScript `Date` at
    local midnight, which can shift a birthday by a day across time zones.
  - We don't use Unix timestamps, for the same reason, and because they're
    negative for anyone born before 1970.
  - `created_at` / `updated_at` are `TIMESTAMPTZ`.
- **Sort order:** family name, case-insensitive, falling back to the full name
  for patients with only a given name.
- **No migrations tool.** The table is created on startup if missing. While
  the schema is still changing in development, we reset with
  `docker compose down -v` and reseed.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/session` | Log in with `{ email, password }`. Returns the user and sets the session cookie. |
| GET | `/api/session` | The logged-in user, or `401`. The front end calls it on page load. |
| DELETE | `/api/session` | Log out. Returns `204`. |
| GET | `/api/reference` | Status list (with labels + descriptions) and US states for the form's dropdowns, so the client has no duplicate copy. |
| POST | `/api/patients/_search` | List patients, excluding entered-in-error. Body: `{ "search": "maria", "status": "active" }` (both optional). A POST so patient details stay out of URLs (see below). |
| POST | `/api/patients` | Create. Returns `201` + patient. |
| PUT | `/api/patients/:id` | Replace. Returns the updated patient. |
| DELETE | `/api/patients/:id` | Sets status to `entered-in-error` (no row is erased). Returns `204`. |

All routes except `/api/session` return `401` without a valid session.

**Errors**
- Validation failures return `400` with `{ "errors": { "<dotted.path>": "message" } }`,
  e.g. `"address.postalCode": "Use a 5-digit ZIP (or ZIP+4)"`. The form shows
  each message under the field with that path.
- Unknown or non-numeric ids return `404`.
- Unexpected errors return `500` with a generic JSON message. The stack trace
  is logged; the request body never is, because it holds PHI.

**Search**
- **Search terms go in the request body, not the URL.** URLs are written to
  server, proxy and monitoring logs. Names and birth dates there would leak
  patient data. FHIR defines `POST [base]/Patient/_search` for the same
  reason, and we borrow its path.
- Search is done on the server. The query is split into words, and **every
  word** must appear in one of: the full name, the preferred name, or the
  birth date (ISO or MM/DD/YYYY).
- Matching ignores case and accents (`ILIKE` + `unaccent`): "jose munoz" finds
  *José Muñoz*.
- `%` and `_` are escaped so they match literally rather than as wildcards.

## Authentication

- **Accounts:** a `users` table (email, name, password hash).
  - Accounts are created with `npm run create-user -- <email> "<name>"`,
    which prints a random temporary password once.
  - `npm run seed` also creates the demo login `demo@example.com` /
    `demo-password`.
- **Passwords:** hashed with `scrypt` and a random 16-byte salt, stored as
  `salt:hash`. They're checked with `timingSafeEqual`.
- **Login failures:**
  - A wrong email and a wrong password both return the same "Email or
    password is incorrect".
  - Both also take the same time: an unknown email is checked against a dummy
    hash. Otherwise, response time would reveal which emails have accounts.
- **Sessions:**
  - Stored in Postgres (a `session` table, created automatically). The browser
    only holds a cookie with the session id.
  - The session id is regenerated on login, which prevents session fixation
    (an attacker planting a known session id before the user logs in).
- **Cookie settings:**
  - `httpOnly`: page scripts can't read the cookie.
  - `sameSite: lax`: other sites can't make requests using it.
  - `secure` in production: sent only over HTTPS.
  - Signed with `SESSION_SECRET`.
- **Idle logoff:** `maxAge` is 15 minutes with `rolling: true`. Every request
  pushes the expiry back to 15 minutes from now, so the session ends after 15
  minutes of *inactivity*.
- **Who sees what:** any logged-in provider sees all patients (PRODUCT.md §7),
  so `requireAuth` only checks that someone is logged in.

## Audit log

The design comes from PRODUCT.md §7. In code:

- **Table:** `audit_log` (`occurred_at`, `user_id`, `action`, `patient_ids
  INTEGER[]`, `attempted_email`, `ip_address`).
  - Actions: `create`, `update`, `delete`, `query`, `login`, `login_failed`,
    `logout`.
- **Recording:** `audit(req, action, …)` in `audit.js` fills in the
  logged-in user and IP address from the request.
- **Writes are atomic:** each patient create/update/delete runs in
  `transaction()` together with its audit insert. If the audit insert fails,
  the patient change is rolled back too, so no change is ever saved without
  its audit record.
- **Searches fail closed:** the `query` entry, with the ids of every patient
  in the results, is written *before* the response is sent. If it fails, the
  provider gets a 500 and no results.
- **Append-only:** the app has no code that updates or deletes audit rows.
  Enforcing this in the database itself (revoking `UPDATE`/`DELETE`) is on
  the Later list.
- **Reviewing it:** for now, with SQL. For example, "who has seen patient 42?":
  ```sql
  SELECT occurred_at, user_id, action FROM audit_log
  WHERE 42 = ANY(patient_ids) ORDER BY occurred_at;
  ```

Planned scale work and future features are tracked in
[PRODUCT.md → Later](PRODUCT.md#later-post-mvp).

## Build order

1. ✅ **Backend**: schema, validation, REST API, seed data (tested with curl)
2. ✅ **Postgres**: switch from SQLite, Docker Compose setup
3. ✅ **Search out of URLs**: `POST /api/patients/_search`
4. ✅ **Login**: provider accounts (created by script), sessions, 15-minute idle logoff
5. ✅ **Audit log**: record who viewed, created, edited or deleted which patient
6. **Frontend**: login screen; patient table with debounced live search and status filter
7. **Frontend**: add/edit modal form (inline errors) and delete with confirmation
