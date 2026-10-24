# Patient Tracker: Technical Plan

How the product decisions in [PRODUCT.md](PRODUCT.md) are built.
The guiding rule is **the simplest thing that's correct**: well-known
libraries, few moving parts, and code a new reader can follow.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Front end | **React** (Vite) | Widely known; fast dev server; almost no config. |
| Back end | **Express 5** | The smallest well-known Node HTTP framework. v5 forwards errors from async handlers automatically. |
| Database | **SQLite** via `better-sqlite3` | A single file and no server to install. The synchronous API keeps the code linear and readable. |
| Validation | **Zod** | Declares each field rule once, and produces readable per-field error messages. |

## Layout

```
patient-tracker/
├── PRODUCT.md          product decisions and reasoning
├── TECHNICAL_PLAN.md   this file
├── server/
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
  "createdAt": "2026-10-24 16:35:45",
  "updatedAt": "2026-10-24 16:35:45"
}
```

`name.text` (FHIR's display name) is **computed by the server** from the other
name parts. Clients never send it.

## Database

- **One flat `patients` table**, one column per field. Flat columns are easy
  to query and index.
  - `givenNames` is stored as JSON text, because it's a list.
  - `nameText` is stored so search can match against the full name.
- **Translation:** `toPatient` / `toRow` in `db.js` convert between flat rows
  and the nested JSON. This is the only translation layer.
- **Status constraint:** a `CHECK` constraint on `status` means the database
  itself rejects invalid codes, as a backstop behind the API's own check.
- **Dates:** stored as `YYYY-MM-DD` text, which matches `<input type="date">`
  and sorts correctly as plain text.
- **Sort order:** family name, falling back to the full name for patients with
  only a given name.
- **No migrations tool.** The table is created on startup if missing. While
  the schema is still changing in development, we delete `patients.db` and
  reseed.

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
- Unknown ids return `404`.

**Search**
- Search is done on the server. The query is split into words, and **every
  word** must appear in one of: the full name, the preferred name, or the
  birth date (ISO or MM/DD/YYYY).
- `%` and `_` are escaped so they match literally rather than as wildcards.

Planned scale work and future features are tracked in
[PRODUCT.md → Later](PRODUCT.md#later-post-mvp).

## Build order

1. ✅ **Backend**: schema, validation, REST API, seed data (tested with curl)
2. **Frontend**: patient table with debounced live search and status filter
3. **Frontend**: add/edit modal form (inline errors) and delete with confirmation
