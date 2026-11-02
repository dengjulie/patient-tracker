// Fills an empty database with two demo practices for development, each with
// its own login, so practice isolation can be seen side by side:
// - Demo Practice: five hand-written edge cases (PRODUCT.md §1: middle
//   names, a suffix, a preferred name, a prefix, one name only) plus
//   generated patients.
// - Second Demo Practice: a few generated patients of its own.
//
//   npm run seed            Demo Practice gets 5 edge cases + 250 generated
//   npm run seed -- 5000    5 edge cases + 5000 (for scale testing)
//
// All data is fake (PRODUCT.md §7: seed data must never be real PHI).
import {
  fakerEN_US, fakerES_MX, fakerVI, fakerPT_BR, fakerFR, fakerPL, fakerTR,
} from '@faker-js/faker';
import {
  closePools, initDb, withPractice, listPatients, createPatient, setPatientTimestamps,
  createUser, findUserByEmail, findOrCreatePractice, DEFAULT_PRACTICE,
} from './db.js';
import { hashPassword } from './auth.js';

const GENERATED_COUNT = Number(process.argv[2] ?? 250);

// Known passwords so reviewers can log in. Real accounts get a random one
// from create-user.js.
const DEMO_PRACTICES = [
  {
    name: DEFAULT_PRACTICE,
    user: { email: 'demo@example.com', name: 'Demo Provider', password: 'demo-password' },
    withEdgeCases: true,
    generatedCount: GENERATED_COUNT,
  },
  {
    name: 'Second Demo Practice',
    user: { email: 'second@example.com', name: 'Second Provider', password: 'demo-password' },
    withEdgeCases: false,
    generatedCount: 20,
  },
];

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
    name: { prefix: '', given: [], family: 'Wulandari', suffix: '' },
    preferredName: '',
    birthDate: '1969-06-06',
    status: 'waitlist',
    address: address(['77 Kalakaua Ave'], 'Honolulu', 'HI', '96815'),
  },
  {
    // No fixed address: only the city and state are known.
    name: { prefix: '', given: ['Marcus'], family: 'Webb', suffix: '' },
    preferredName: '',
    birthDate: '1958-09-14',
    status: 'active',
    address: address([], 'Denver', 'CO', ''),
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
      // A single name goes in the last-name field (PRODUCT.md §1).
      given: onlyOneName ? [] : given,
      family: onlyOneName ? given[0] : people.lastName(),
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

// Spread history over time so the list (newest first) looks like real use.
// The edge cases changed in the last few hours, so they lead page 1;
// generated patients were added in the past 2 years and last updated
// before yesterday.
const HOUR = 60 * 60 * 1000;

function edgeCaseHistory(index) {
  const updatedAt = new Date(Date.now() - (index + 1) * HOUR);
  return { createdAt: new Date(updatedAt - 30 * 24 * HOUR), updatedAt };
}

function generatedHistory() {
  const createdAt = f.date.past({ years: 2 });
  const updatedAt = f.date.between({ from: createdAt, to: Date.now() - 24 * HOUR });
  return { createdAt, updatedAt: updatedAt < createdAt ? createdAt : updatedAt };
}

await initDb();

for (const demo of DEMO_PRACTICES) {
  const { practice } = await findOrCreatePractice(demo.name);

  if (await findUserByEmail(demo.user.email)) {
    console.log(`${demo.user.email} already exists; skipping.`);
  } else {
    await createUser({ ...demo.user, practiceId: practice.id, passwordHash: await hashPassword(demo.user.password) });
    console.log(`Created login for ${practice.name}: ${demo.user.email} / ${demo.user.password}`);
  }

  // Inserted through withPractice, like the app's own writes. One
  // transaction per practice: much faster than committing each insert.
  await withPractice(practice.id, async (db) => {
    if ((await listPatients(db)).total > 0) {
      console.log(`${practice.name} already has patients; skipping.`);
      return;
    }
    const edgeCases = demo.withEdgeCases ? samples : [];
    const patients = [...edgeCases, ...Array.from({ length: demo.generatedCount }, generatePatient)];
    for (const [i, patient] of patients.entries()) {
      const created = await createPatient(db, patient);
      await setPatientTimestamps(db, created.id, i < edgeCases.length ? edgeCaseHistory(i) : generatedHistory());
    }
    console.log(`Seeded ${practice.name} with ${patients.length} patients.`);
  });
}
await closePools();
