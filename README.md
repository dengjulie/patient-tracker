# Patient Tracker

A web app for healthcare providers to record and view patients' critical data:
name, date of birth, status, and address. Patient data follows the
[FHIR](https://hl7.org/fhir/) standard, and all access requires a login.

**Status:** login and the patient list (search + status filter) work end to
end. Adding, editing and deleting patients from the UI is next. See the build
order in
[ARCHITECTURE.md](ARCHITECTURE.md#build-order).

## Docs

| Doc | What's in it |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Every product decision and the reasoning behind it: where we followed FHIR over the original requirements, US-only addresses, HIPAA-driven security, MVP scope, and the post-MVP backlog. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack choices, data model, **database schema** (with diagram), API reference, authentication, and build order. |
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
# then set SESSION_SECRET in .env to a random string:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Install, add demo data, and start the API on http://localhost:3001
npm install
npm run seed
npm run dev

# 4. In a second terminal, start the front end
cd client
npm install
npm run dev
```

Then open **http://localhost:5173**.

**Demo login:** `demo@example.com` / `demo-password` (created by `npm run seed`).

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
| `npm run dev` | Start the API and restart it on file changes. |
| `npm start` | Start the API. |
| `npm run seed` | Create the demo login and sample patients (skips anything already there). |
| `npm run create-user -- <email> "<name>"` | Create a provider account and print a temporary password. There's no sign-up page by design ([PRODUCT.md §7](PRODUCT.md#7-security-and-privacy)). |

To reset the database: `docker compose down -v && docker compose up -d`, then
`npm run seed`.

## Project structure

```
patient-tracker/
├── README.md            you are here
├── PRODUCT.md           product decisions and reasoning
├── ARCHITECTURE.md      stack, schema, API, auth, audit log
├── CLAUDE.md            instructions for Claude Code
├── docker-compose.yml   local Postgres
├── server/              Express API
│   ├── index.js         routes and request validation (Zod)
│   ├── db.js            schema and every SQL query
│   ├── audit.js         records audit log entries
│   ├── auth.js          passwords, sessions, login/logout
│   ├── constants.js     FHIR status codes and US states
│   ├── seed.js          demo login and sample patients
│   ├── create-user.js   admin script to add a provider account
│   └── .env.example     config template (DATABASE_URL, SESSION_SECRET)
└── client/              React front end (Vite + Mantine)
    ├── vite.config.js   dev server; proxies /api to Express
    └── src/
        ├── main.jsx         entry point, Mantine theme provider
        ├── App.jsx          login page vs patients page; session-end messages
        ├── LoginPage.jsx    login form
        ├── PatientsPage.jsx patient table, search, status filter
        ├── api.js           every backend call; browser-side idle logoff
        └── format.js        name, date and age formatting
```

## Stack

React 19 (Vite) · Mantine 9 · Express 5 · PostgreSQL 17 · Zod · express-session.
Why each was chosen: [ARCHITECTURE.md → Stack](ARCHITECTURE.md#stack).
