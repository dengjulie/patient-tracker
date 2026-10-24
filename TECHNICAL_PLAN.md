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
| Validation | **Zod** | Declares each field rule once, and produces readable per-field error messages. |

## Layout

```
patient-tracker/
├── PRODUCT.md          product decisions and reasoning
├── TECHNICAL_PLAN.md   this file
├── docker-compose.yml  local Postgres (host port 5433)
├── server/
│   ├── .env.example    DATABASE_URL; copy to .env
│   ├── constants.js    status list (FHIR) and US state list
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
| GET | `/api/reference` | Status list (with labels + descriptions) and US states for the form's dropdowns, so the client has no duplicate copy. |
| GET | `/api/patients?search=&status=` | List patients, excluding entered-in-error. |
| POST | `/api/patients` | Create. Returns `201` + patient. |
| PUT | `/api/patients/:id` | Replace. Returns the updated patient. |
| DELETE | `/api/patients/:id` | Sets status to `entered-in-error` (no row is erased). Returns `204`. |

**Errors**
- Validation failures return `400` with `{ "errors": { "<dotted.path>": "message" } }`,
  e.g. `"address.postalCode": "Use a 5-digit ZIP (or ZIP+4)"`. The form shows
  each message under the field with that path.
- Unknown or non-numeric ids return `404`.

**Search**
- Search is done on the server. The query is split into words, and **every
  word** must appear in one of: the full name, the preferred name, or the
  birth date (ISO or MM/DD/YYYY).
- Matching ignores case and accents (`ILIKE` + `unaccent`): "jose munoz" finds
  *José Muñoz*.
- `%` and `_` are escaped so they match literally rather than as wildcards.

Planned scale work and future features are tracked in
[PRODUCT.md → Later](PRODUCT.md#later-post-mvp).

## Build order

1. ✅ **Backend**: schema, validation, REST API, seed data (tested with curl)
2. ✅ **Postgres**: switch from SQLite, Docker Compose setup
3. **Frontend**: patient table with debounced live search and status filter
4. **Frontend**: add/edit modal form (inline errors) and delete with confirmation
