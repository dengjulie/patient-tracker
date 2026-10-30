import express from 'express';
import { z } from 'zod';
import { STATUSES, US_STATES } from './constants.js';
import {
  initDb,
  listPatients,
  createPatient,
  updatePatient,
  patientExists,
  findPatientsBornOn,
  markEnteredInError,
  transaction,
} from './db.js';
import { sessions, requireAuth, login, logout, currentUser } from './auth.js';
import { audit } from './audit.js';
import { planImport } from './import.js';

// One schema describes a valid patient, shaped like FHIR (see PRODUCT.md).
// Each message is written to be shown directly under the matching form field.
const optionalText = z.string().trim().default('');
const required = (label) => z.string(`${label} is required`).trim().min(1, `${label} is required`);
const today = () => new Date().toISOString().slice(0, 10);

const patientSchema = z.object({
  name: z
    .object({
      prefix: optionalText,
      given: z
        .array(z.string().trim())
        .default([])
        // A blank name ahead of a filled one would move every name up a place
        // (a middle name would come back as the first name).
        .refine((names) => names.slice(0, names.findLastIndex(Boolean) + 1).every(Boolean), 'Enter a first name before any middle names')
        .transform((names) => names.filter(Boolean)),
      family: optionalText,
      suffix: optionalText,
    }, 'Name is required')
    // US Core rule: a name needs at least a given or a family name.
    .refine((n) => n.given.length > 0 || n.family, {
      message: 'Enter a given name or a family name',
      path: ['given'],
    }),
  preferredName: optionalText,
  birthDate: z.iso
    .date('Enter a valid date of birth')
    .refine((d) => d <= today(), 'Date of birth cannot be in the future'),
  // Patients can't be set to entered-in-error here; only DELETE does that.
  status: z.enum(STATUSES.map((s) => s.code), 'Choose a status'),
  address: z.object(
    {
      line: z
        .array(z.string().trim())
        .max(2)
        .refine((lines) => lines[0], 'Street address is required')
        .transform((lines) => lines.filter(Boolean)),
      city: required('City'),
      state: z.enum(US_STATES.map((s) => s.code), 'Choose a state'),
      postalCode: z.string('ZIP is required').trim().regex(/^\d{5}(-\d{4})?$/, 'Use a 5-digit ZIP (or ZIP+4)'),
    },
    'Address is required'
  ),
});

// Returns { data } for a valid patient, or { errors: { "address.city": message } }.
// Keys are dotted paths, so the form can match each error to its field.
function parsePatient(body) {
  const result = patientSchema.safeParse(body ?? {});
  if (result.success) return { data: result.data };

  const errors = {};
  for (const issue of result.error.issues) {
    errors[issue.path.join('.')] ??= issue.message;
  }
  return { errors };
}

// Returns the cleaned patient, or sends a 400 with its errors.
function validate(body, res) {
  const { data, errors } = parsePatient(body);
  if (errors) res.status(400).json({ errors });
  return data;
}

// Ids are positive integers; anything else can't match a patient.
const parseId = (param) => (/^\d{1,9}$/.test(param) ? Number(param) : undefined);

const app = express();
// Large enough for a CSV import of MAX_IMPORT_ROWS patients (about 2 MB).
app.use(express.json({ limit: '5mb' }));
app.use(sessions);

// Logging in and out are the only routes open without a session.
app.post('/api/session', login);
app.get('/api/session', currentUser);
app.delete('/api/session', logout);

// Everything else under /api requires a logged-in provider.
app.use('/api', requireAuth);

// Lists the form's dropdowns need, so the front end doesn't keep its own copy.
app.get('/api/reference', (req, res) => {
  res.json({ statuses: STATUSES, states: US_STATES });
});

// Search is a POST so names and birth dates travel in the request body, not
// the URL, where they'd end up in server logs and browser history.
// FHIR does the same with POST [base]/Patient/_search.
const searchSchema = z.object({
  search: z.string().trim().default(''),
  status: z.string().default(''),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

app.post('/api/patients/_search', async (req, res) => {
  const query = searchSchema.safeParse(req.body ?? {});
  if (!query.success) {
    return res.status(400).json({ error: 'search and status must be strings; page and pageSize (max 100) positive integers' });
  }
  const { patients, total } = await listPatients(query.data);
  // Logged before responding: if the audit write fails, no results are sent.
  // Only the patients on this page were shown, so only they are logged.
  await audit(req, 'query', { patientIds: patients.map((p) => p.id) });
  res.json({ patients, total, page: query.data.page, pageSize: query.data.pageSize });
});

// Each write and its audit entry run in one transaction, so a change is
// never saved without its audit record.

app.post('/api/patients', async (req, res) => {
  const data = validate(req.body, res);
  if (!data) return;
  const patient = await transaction(async (tx) => {
    const created = await createPatient(data, tx);
    await audit(req, 'create', { patientIds: [created.id] }, tx);
    return created;
  });
  res.status(201).json(patient);
});

// The If-Match header carries the updatedAt the editor loaded (HTTP's and
// FHIR's way to stop two people overwriting each other's changes). If the
// patient was saved since, the update is refused with 412.
const ifMatchSchema = z.iso.datetime().optional();

app.put('/api/patients/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Patient not found' });
  const ifMatch = ifMatchSchema.safeParse(req.get('If-Match')?.replace(/^W\//, '').replaceAll('"', ''));
  if (!ifMatch.success) return res.status(412).json({ error: 'If-Match must be the patient\'s updatedAt' });
  const data = validate(req.body, res);
  if (!data) return;
  const patient = await transaction(async (tx) => {
    const updated = await updatePatient(id, data, ifMatch.data, tx);
    if (updated) await audit(req, 'update', { patientIds: [id] }, tx);
    return updated;
  });
  if (!patient) {
    if (ifMatch.data && (await patientExists(id))) {
      return res.status(412).json({ error: 'Someone else changed this patient' });
    }
    return res.status(404).json({ error: 'Patient not found' });
  }
  res.json(patient);
});

// CSV import (PRODUCT.md §8). The browser reads the file and maps its columns,
// then sends FHIR-shaped patients, as POST /api/patients takes. Each one is
// checked and sorted (see import.js). With dryRun, only that plan is returned,
// for the provider to review; otherwise the new patients are created, plus
// the possible duplicates if the provider chose to include them.
const MAX_IMPORT_ROWS = 5000;
const importSchema = z.object({
  patients: z.array(z.unknown()).min(1).max(MAX_IMPORT_ROWS),
  dryRun: z.boolean().default(false),
  includeDuplicates: z.boolean().default(false),
});

app.post('/api/patients/_import', async (req, res) => {
  const body = importSchema.safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: `Send 1 to ${MAX_IMPORT_ROWS} patients; dryRun and includeDuplicates are booleans` });
  }
  const { patients, dryRun, includeDuplicates } = body.data;
  const rows = patients.map(parsePatient);
  const birthDates = [...new Set(rows.filter((row) => row.data).map((row) => row.data.birthDate))];
  const { matchedIds, ...plan } = planImport(rows, await findPatientsBornOn(birthDates));
  // The plan reveals which patients are already on file, so it's logged like
  // a search, before responding.
  await audit(req, 'query', { patientIds: matchedIds });
  if (dryRun) return res.json(plan);

  const toCreate = [...plan.ready, ...(includeDuplicates ? plan.duplicates.map((d) => d.index) : [])];
  let created = 0;
  if (toCreate.length) {
    // One transaction: the whole import and its audit entry, or nothing.
    await transaction(async (tx) => {
      const ids = [];
      for (const index of toCreate) ids.push((await createPatient(rows[index].data, tx)).id);
      await audit(req, 'create', { patientIds: ids }, tx);
      created = ids.length;
    });
  }
  res.json({ ...plan, created });
});

app.delete('/api/patients/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Patient not found' });
  const found = await transaction(async (tx) => {
    const marked = await markEnteredInError(id, tx);
    if (marked) await audit(req, 'delete', { patientIds: [id] }, tx);
    return marked;
  });
  if (!found) return res.status(404).json({ error: 'Patient not found' });
  res.status(204).end();
});

// Unexpected errors: log the stack trace (never the request body, which holds
// PHI), and send a generic JSON message instead of Express's HTML error page.
// Errors with a 4xx status, such as malformed JSON, keep their status.
app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err.stack);
  res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : 'Invalid request' });
});

await initDb();
const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
