// Fills an empty database with a demo login and sample patients for
// development. The patients cover the name cases from PRODUCT.md §1: middle
// names, a suffix, a preferred name, a prefix, and a patient with only one name.
import { pool, initDb, listPatients, createPatient, createUser, findUserByEmail } from './db.js';
import { hashPassword } from './auth.js';

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
  for (const sample of samples) await createPatient(sample);
  console.log(`Seeded ${samples.length} patients.`);
}
await pool.end();
