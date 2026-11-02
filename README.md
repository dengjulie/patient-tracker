# Patient Roster

A web app for healthcare providers to record and view patients' critical data:
name, date of birth, status, and address. Patient data follows the
[FHIR](https://hl7.org/fhir/) standard, and all access requires a login.

**Status:** the MVP is complete: log in, then add, view, search, filter,
page through, edit and delete patients, with every action audit-logged. See
the build order in
[ARCHITECTURE.md](ARCHITECTURE.md#build-order).

## Docs

| Doc | What's in it |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Every product decision and the reasoning behind it: where we followed FHIR over the original requirements, US-only addresses, HIPAA-driven security, MVP scope, and the post-MVP backlog. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | An **architecture diagram** and one request traced end to end, stack choices, data model, **database schema** (with diagram), API reference, authentication, and build order. |
| [CLAUDE.md](CLAUDE.md) | How this project was built with Claude Code: who makes decisions, code standards, verification. |

## Running locally

**Prerequisites:** [Node.js](https://nodejs.org/) 20.6 or newer, and
[Docker](https://www.docker.com/) for the database.

```sh
# 1. Start Postgres (runs on port 5433)
docker compose up -d

# 2. Configure the server
cd server
cp .env.example .env
# then in .env, set SESSION_SECRET (and, outside local development, the app
# login's password in DATABASE_URL) to random strings:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Install, add demo data, and start the API on http://localhost:3001
npm install
npm run seed   # sets up the database first
npm run dev    # updates the database, then starts the API

# 4. In a second terminal, start the front end
cd client
npm install
npm run dev
```

Then open **http://localhost:5173**.

The server uses two database logins from `.env`: the **owner**
(`DATABASE_OWNER_URL`) only sets up the database and runs the admin scripts,
and the API runs as a **restricted app login** (`DATABASE_URL`), which can't
delete patients, alter the audit log, or see other practices' patients. See
[ARCHITECTURE.md → Database logins](ARCHITECTURE.md#database-logins).

**Demo logins** (created by `npm run seed`), one per practice, to see that
providers only see their own practice's patients:

| Email | Password | Practice |
| --- | --- | --- |
| `demo@example.com` | `demo-password` | Demo Practice (255 patients) |
| `second@example.com` | `demo-password` | Second Demo Practice (20 patients) |

### Trying the API

You can also call the API directly with `curl`:

```sh
# Log in (saves the session cookie to cookies.txt)
curl -c cookies.txt -X POST localhost:3001/api/session \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-password"}'

# Search patients by name or date of birth
curl -b cookies.txt -X POST localhost:3001/api/patients/_search \
  -H 'Content-Type: application/json' \
  -d '{"search":"maria"}'
```

All endpoints are listed in [ARCHITECTURE.md → API](ARCHITECTURE.md#api).

### Scripts (run in `server/`)

| Command | What it does |
| --- | --- |
| `npm run migrate` | Set up or update the database as the owner: tables, the app login and its rights. Safe to run again. |
| `npm run dev` | Run `migrate`, then start the API and restart it on file changes. |
| `npm start` | Start the API (run `migrate` first after pulling changes). |
| `npm run seed` | Create two demo practices with a login each: Demo Practice gets 5 hand-written edge-case patients and 250 generated ones, Second Demo Practice 20 generated ones, with realistic history spread over two years (skips anything already there). `npm run seed -- 5000` generates more, for scale testing. All data is fake. |
| `npm run audit-log` | Show the audit log, newest first. Filters combine: `-- --patient 42`, `--user demo@example.com`, `--practice "Demo Practice"`, `--action login_failed`, `--since 2026-11-01`, `--limit 200`. The output is PHI. |
| `npm run create-user -- <email> "<name>" "<practice>"` | Create a provider account in a practice (created if new) and print a temporary password. There's no sign-up page by design ([PRODUCT.md §7](PRODUCT.md#7-security-and-privacy)). |

To reset the database: `docker compose down -v && docker compose up -d`, then
`npm run seed`.

### Tests

```bash
cd server && npm test   # needs Postgres running (docker compose up -d) and server/.env
cd client && npm test
```

Both use Node's built-in test runner; there's nothing extra to install.

| Suite | Kind | What it checks |
| --- | --- | --- |
| `server/test/isolation.test.js` | Integration (database) | Practice isolation in Postgres itself: row-level security hides other practices even from a query with no practice filter, and sees nothing with no practice set; patients can't be added to or moved into another practice; the app's database role can't hard-delete patients or change or delete audit entries; the role and practice never leak to the next query on a pooled connection. |
| `server/test/api.test.js` | Integration (API) | Through the real routes, as two providers in two practices: every patient route needs a login; searches, recent patients and CSV import matching stay inside the practice; another practice's patient is "not found" for reading, editing and deleting; audit entries record the practice; two simultaneous saves give one success and one `412`; deleted patients stay deleted; search-first; search requests with bad page numbers, page sizes or types are refused. |
| `server/test/search.test.js` | Integration (database) | Finding patients, with exact expected results: most recently updated first, with ties ordered by id; the status filter alone and with a search; name search ignoring case and accents, matching every word in any name part (middle, preferred, prefix, suffix, single names), with `%` and `_` taken literally; date of birth in US or ISO format, in part, and with a name; deleted and other practices' patients never listed; paging without gaps or repeats. |
| `server/test/import.test.js` | Unit | How CSV rows are sorted: invalid, already imported (ignoring case and status), possible duplicates, ready. |
| `client/test/csvImport.test.js` | Unit | Turning spreadsheet rows into patients: column-name guesses, US dates, ZIPs that lost leading zeros, state names and status labels. |

The integration tests create a throwaway database for each file
(`patient_tracker_test_<pid>`) and drop it at the end, so they never touch
development data. They run one file at a time.

## Project structure

```
patient-tracker/
├── README.md            you are here
├── PRODUCT.md           product decisions and reasoning
├── ARCHITECTURE.md      stack, schema, API, auth, audit log
├── CLAUDE.md            instructions for Claude Code
├── docker-compose.yml   local Postgres
├── server/              Express API
│   ├── index.js         starts the API
│   ├── migrate.js       sets up the database (npm run migrate)
│   ├── audit-log.js     shows the audit log (npm run audit-log)
│   ├── app.js           routes and request validation (Zod)
│   ├── db.js            schema and every SQL query
│   ├── import.js        sorts CSV import rows (new, already imported, duplicate, invalid)
│   ├── audit.js         records audit log entries
│   ├── auth.js          passwords, sessions, login/logout
│   ├── constants.js     FHIR status codes and US states
│   ├── seed.js          demo login + fake patients (edge cases and generated)
│   ├── create-user.js   admin script to add a provider account to a practice
│   └── .env.example     config template (two database logins, SESSION_SECRET)
│   └── test/            unit and integration tests (npm test)
└── client/              React front end (Vite + Mantine)
    ├── vite.config.js   dev server; proxies /api to Express
    └── src/
        ├── main.jsx         entry point, Mantine theme provider
        ├── App.jsx          login page vs patients page; session-end messages
        ├── LoginPage.jsx    login form
        ├── PatientsPage.jsx patient table, search, status filter, paging
        ├── PatientDrawer.jsx side panel: view, add or edit a patient
        ├── PatientTable.jsx patient table (search results, recent patients)
        ├── ListHeader.jsx   title and description above each patient list
        ├── RecentPatients.jsx your recent patients, shown before searching
        ├── PatientForm.jsx  add/edit form and delete confirmation
        ├── ImportPatients.jsx CSV import: choose file, map columns, review
        ├── csvImport.js     turns CSV rows into patients for the API
        ├── api.js           every backend call; browser-side idle logoff
        └── format.js        name, date and age formatting
```

## Stack

React 19 (Vite) · Mantine 9 · Express 5 · PostgreSQL 17 · Zod · express-session.
Why each was chosen: [ARCHITECTURE.md → Stack](ARCHITECTURE.md#stack).
