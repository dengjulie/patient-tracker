# Patient Tracker: Architecture

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
├── ARCHITECTURE.md    this file
├── docker-compose.yml  local Postgres (host port 5433)
├── server/
│   ├── .env.example    DATABASE_URL, SESSION_SECRET; copy to .env
│   ├── audit.js        builds an audit entry from the request
│   ├── auth.js         password hashing, sessions, login/logout, requireAuth
│   ├── constants.js    status list (FHIR) and US state list
│   ├── create-user.js  admin script: create a provider account
│   ├── db.js           schema + every SQL query (routes contain no SQL)
│   ├── index.js        Express routes + Zod validation
│   └── seed.js         demo login + sample patients covering the edge cases
└── client/             React front end (coming next)
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

## Schema

[`db.js`](server/db.js) (`initDb`) is the source of truth; this section
explains it. **Update this section whenever the schema changes.**

```mermaid
erDiagram
    users ||--o{ audit_log : "performs"
    patients }o--o{ audit_log : "appears in (patient_ids[])"

    patients {
        integer id PK
        text name_prefix
        text_array given_names
        text family_name
        text name_suffix
        text name_text "computed display name"
        text preferred_name
        date birth_date
        text status "CHECK: FHIR codes"
        text address_line1
        text address_line2
        text city
        text state
        text postal_code
        timestamptz created_at
        timestamptz updated_at
    }
    users {
        integer id PK
        text email UK "lowercased"
        text name
        text password_hash "scrypt salt:hash"
        timestamptz created_at
    }
    audit_log {
        bigint id PK
        timestamptz occurred_at
        integer user_id FK
        text action "CHECK: 7 actions"
        integer_array patient_ids
        text attempted_email
        text ip_address
    }
    session {
        varchar sid PK
        json sess "contains the logged-in user"
        timestamp expire
    }
```

### `patients`

One row per patient. Columns are flat and `snake_case` (the Postgres
convention); the API converts them to nested, FHIR-shaped JSON.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER` | PK, identity | Works like a medical record number, so it's PHI. |
| `name_prefix` | `TEXT` | not null, default `''` | FHIR `name.prefix` (Dr., Mx.). |
| `given_names` | `TEXT[]` | not null, default `{}` | FHIR `name.given`: first and middle names, in order. |
| `family_name` | `TEXT` | not null, default `''` | FHIR `name.family`. Empty for patients with only one name. |
| `name_suffix` | `TEXT` | not null, default `''` | FHIR `name.suffix` (Jr., III). |
| `name_text` | `TEXT` | not null | FHIR `name.text`: the full display name, **computed by the server** and stored so search can match it. |
| `preferred_name` | `TEXT` | not null, default `''` | FHIR name with `use = usual`. |
| `birth_date` | `DATE` | not null | Returned as `YYYY-MM-DD` text (see Conventions). |
| `status` | `TEXT` | not null, `CHECK` in FHIR codes | `planned`, `waitlist`, `active`, `onhold`, `finished`, `cancelled`, `entered-in-error`. |
| `address_line1` | `TEXT` | not null | Street. |
| `address_line2` | `TEXT` | not null, default `''` | Apt / unit. |
| `city` | `TEXT` | not null | |
| `state` | `TEXT` | not null | 2-letter code; the API checks it against the 59 US codes. |
| `postal_code` | `TEXT` | not null | Text, so leading zeros survive (`02110`). |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | not null, default `now()` | |

- **Status check in the database:** the API validates the status, and the
  `CHECK` constraint backs it up, so the database itself rejects anything
  else.
- **Rows are never deleted:** "delete" sets `status = 'entered-in-error'`.
- **The address is stored in full** as five columns, the way Epic's
  reporting database stores a patient's current address. A separate
  addresses table (multiple addresses, history) is on the Later list.

### `users`

Provider accounts, created by `create-user.js` (no sign-up).

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `INTEGER` | PK, identity | |
| `email` | `TEXT` | not null, unique | Stored lowercased, so login ignores case. |
| `name` | `TEXT` | not null | |
| `password_hash` | `TEXT` | not null | `salt:hash` from scrypt. Never returned by the API. |
| `created_at` | `TIMESTAMPTZ` | not null, default `now()` | |

### `audit_log`

Append-only record of patient access and logins (PRODUCT.md §7). Holds patient
ids, never names or search terms.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, identity | `BIGINT` because this table grows fastest. |
| `occurred_at` | `TIMESTAMPTZ` | not null, default `now()` | |
| `user_id` | `INTEGER` | FK → `users.id`, nullable | Null only for a failed login with an unknown email. |
| `action` | `TEXT` | not null, `CHECK` | `create`, `update`, `delete`, `query`, `login`, `login_failed`, `logout`. |
| `patient_ids` | `INTEGER[]` | not null, default `{}` | Every patient the action touched or showed. |
| `attempted_email` | `TEXT` | nullable | Failed logins only. |
| `ip_address` | `TEXT` | nullable | From the request. |

- **No foreign key on `patient_ids`:** Postgres can't enforce foreign keys on
  items inside a list. This is safe because patient rows are never deleted,
  so the ids always stay valid.

### `session`

Created and managed by **connect-pg-simple** (the session store), not by our
code. It's listed so the whole database is documented in one place.

| Column | Type | Notes |
| --- | --- | --- |
| `sid` | `VARCHAR` PK | The session id held in the browser's cookie. |
| `sess` | `JSON` | Session data, including the logged-in user (`id`, `email`, `name`). |
| `expire` | `TIMESTAMP` | Indexed. Pushed 15 minutes ahead on every request (idle logoff). Expired rows are removed automatically. |

### Conventions

- **Translation:** `toPatient` / `toRow` in `db.js` convert between flat
  `snake_case` rows and the nested camelCase JSON. This is the only
  translation layer.
- **Dates:**
  - `birth_date` is a `DATE`. `pg` is told to return it as a plain
    `YYYY-MM-DD` string. Its default turns it into a JavaScript `Date` at
    local midnight, which can shift a birthday by a day across time zones.
  - We don't use Unix timestamps, for the same reason, and because they're
    negative for anyone born before 1970.
- **Sort order:** family name, case-insensitive, falling back to the full name
  for patients with only a given name.
- **No migrations tool.** Tables are created on startup if missing. While the
  schema is still changing in development, we reset with
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

- **Accounts:** the [`users`](#users) table.
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
  - Stored in Postgres (the [`session`](#session) table). The browser only
    holds a cookie with the session id.
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

- **Table:** see [Schema → `audit_log`](#audit_log).
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
