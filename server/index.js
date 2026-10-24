import express from 'express';
import { z } from 'zod';
import { STATUSES, US_STATES } from './constants.js';
import {
  listPatients,
  createPatient,
  updatePatient,
  markEnteredInError,
} from './db.js';

// One schema describes a valid patient, shaped like FHIR (see PRODUCT.md).
// Each message is written to be shown directly under the matching form field.
const optionalText = z.string().trim().default('');
const required = (label) => z.string(`${label} is required`).trim().min(1, `${label} is required`);
const today = () => new Date().toISOString().slice(0, 10);

const patientSchema = z.object({
  name: z
    .object({
      prefix: optionalText,
      given: z.array(z.string().trim()).default([]).transform((names) => names.filter(Boolean)),
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

// Returns the cleaned patient, or sends a 400 with { errors: { "address.city": message } }.
// Keys are dotted paths, so the form can match each error to its field.
function validate(body, res) {
  const result = patientSchema.safeParse(body ?? {});
  if (result.success) return result.data;

  const errors = {};
  for (const issue of result.error.issues) {
    errors[issue.path.join('.')] ??= issue.message;
  }
  res.status(400).json({ errors });
}

const app = express();
app.use(express.json());

// Lists the form's dropdowns need, so the front end doesn't keep its own copy.
app.get('/api/reference', (req, res) => {
  res.json({ statuses: STATUSES, states: US_STATES });
});

app.get('/api/patients', (req, res) => {
  const { search = '', status = '' } = req.query;
  res.json(listPatients({ search: String(search).trim(), status: String(status) }));
});

app.post('/api/patients', (req, res) => {
  const data = validate(req.body, res);
  if (!data) return;
  res.status(201).json(createPatient(data));
});

app.put('/api/patients/:id', (req, res) => {
  const data = validate(req.body, res);
  if (!data) return;
  const patient = updatePatient(req.params.id, data);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json(patient);
});

app.delete('/api/patients/:id', (req, res) => {
  if (!markEnteredInError(req.params.id)) return res.status(404).json({ error: 'Patient not found' });
  res.status(204).end();
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
