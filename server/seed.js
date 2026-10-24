// Fills an empty database with a demo login and fake patients for development:
// five hand-written edge cases (PRODUCT.md §1: middle names, a suffix, a
// preferred name, a prefix, one name only) plus generated patients.
//
//   npm run seed            5 edge cases + 250 generated patients
//   npm run seed -- 5000    5 edge cases + 5000 (for scale testing)
//
// All data is fake (PRODUCT.md §7: seed data must never be real PHI).
import {
  fakerEN_US, fakerES_MX, fakerVI, fakerPT_BR, fakerFR, fakerPL, fakerTR,
} from '@faker-js/faker';
import { pool, initDb, listPatients, createPatient, createUser, findUserByEmail, transaction } from './db.js';
import { hashPassword } from './auth.js';

const GENERATED_COUNT = Number(process.argv[2] ?? 250);

// A known password so reviewers can log in. Real accounts get a random one
// from create-user.js.
const DEMO_USER = { email: 'demo@example.com', name: 'Demo Provider', password: 'demo-password' };

const address = (line, city, state, postalCode) => ({ line, city, state, postalCode });

const samples = [
  {
    name: { prefix: '', given: ['Maria', 'Elena'], family: 'Garcia', suffix: '' },
    preferredName: '',
    birthDate: '1984-03-12',
    status: 'active',
    address: address(['120 Market St', 'Apt 4B'], 'San Francisco', 'CA', '94105'),
  },
  {
    name: { prefix: '', given: ['Robert', 'James'], family: 'Okafor', suffix: 'Jr.' },
    preferredName: 'Bobby',
    birthDate: '1991-07-28',
    status: 'planned',
    address: address(['45 Elm Ave'], 'Austin', 'TX', '78701'),
  },
  {
    name: { prefix: 'Dr.', given: ['Priya'], family: 'Shah', suffix: '' },
    preferredName: '',
    birthDate: '1976-11-02',
    status: 'onhold',
    address: address(['9 Harbor Rd'], 'Boston', 'MA', '02110'),
  },
  {
    name: { prefix: '', given: ['Daniel', 'Lee'], family: 'Chen', suffix: '' },
    preferredName: 'Danny',
    birthDate: '2001-01-19',
    status: 'finished',
    address: address(['300 Pine St', 'Unit 12'], 'Seattle', 'WA', '98101'),
  },
  {
    name: { prefix: '', given: ['Wulandari'], family: '', suffix: '' },
    preferredName: '',
    birthDate: '1969-06-06',
    status: 'waitlist',
    address: address(['77 Kalakaua Ave'], 'Honolulu', 'HI', '96815'),
  },
];

// Names come from several locales so search is exercised on accents and
// multi-part names (Nguyễn, Bétancourt Badillo, Łukasz). Weights are rough
// proportions, not demographics.
const NAME_LOCALES = [
  { weight: 50, value: fakerEN_US },
  { weight: 20, value: fakerES_MX },
  { weight: 8, value: fakerVI },
  { weight: 8, value: fakerPT_BR },
  { weight: 6, value: fakerFR },
  { weight: 4, value: fakerPL },
  { weight: 4, value: fakerTR },
];

const STATUS_WEIGHTS = [
  { weight: 40, value: 'active' },
  { weight: 15, value: 'planned' },
  { weight: 8, value: 'waitlist' },
  { weight: 7, value: 'onhold' },
  { weight: 20, value: 'finished' },
  { weight: 10, value: 'cancelled' },
];

// Fixed seeds, so every reviewer gets the same patients.
for (const { value: locale } of NAME_LOCALES) locale.seed(42);
const f = fakerEN_US;

function generatePatient() {
  const people = f.helpers.weightedArrayElement(NAME_LOCALES).person;
  const onlyOneName = f.datatype.boolean(0.02);
  const given = [people.firstName()];
  if (!onlyOneName && f.datatype.boolean(0.4)) given.push(people.firstName());

  return {
    name: {
      prefix: f.datatype.boolean(0.03) ? 'Dr.' : '',
      given,
      family: onlyOneName ? '' : people.lastName(),
      suffix: f.datatype.boolean(0.03) ? f.helpers.arrayElement(['Jr.', 'Sr.', 'III']) : '',
    },
    preferredName: f.datatype.boolean(0.1) ? fakerEN_US.person.firstName() : '',
    birthDate: f.date.birthdate({ mode: 'age', min: 0, max: 100 }).toISOString().slice(0, 10),
    status: f.helpers.weightedArrayElement(STATUS_WEIGHTS),
    address: address(
      f.datatype.boolean(0.3)
        ? [f.location.streetAddress(), f.location.secondaryAddress()]
        : [f.location.streetAddress()],
      f.location.city(),
      f.location.state({ abbreviated: true }),
      f.location.zipCode('#####')
    ),
  };
}

await initDb();

if (await findUserByEmail(DEMO_USER.email)) {
  console.log('Demo user already exists; skipping.');
} else {
  await createUser({ ...DEMO_USER, passwordHash: await hashPassword(DEMO_USER.password) });
  console.log(`Created demo login: ${DEMO_USER.email} / ${DEMO_USER.password}`);
}

if ((await listPatients()).length > 0) {
  console.log('Database already has patients; skipping seed.');
} else {
  const patients = [...samples, ...Array.from({ length: GENERATED_COUNT }, generatePatient)];
  // One transaction: much faster than committing each insert separately.
  await transaction(async (tx) => {
    for (const patient of patients) await createPatient(patient, tx);
  });
  console.log(`Seeded ${patients.length} patients (${samples.length} edge cases + ${GENERATED_COUNT} generated).`);
}
await pool.end();
