// Integration tests for the API, run against the real app and a test
// database: login, practice isolation through every patient route, edit
// conflicts, and the search-first rule.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTestDatabase, samplePatient, TEST_PASSWORD } from './setup.js';

const { db, drop } = await useTestDatabase();
const { app } = await import('../app.js');
const { hashPassword } = await import('../auth.js');
const { pool, withPractice, findOrCreatePractice, createUser, createPatient } = db;

// Two practices, each with one provider and patients of its own.
const { practice: a } = await findOrCreatePractice('Practice A');
const { practice: b } = await findOrCreatePractice('Practice B');
const passwordHash = await hashPassword(TEST_PASSWORD);
const userB = await createUser({ practiceId: b.id, email: 'b@test.example', name: 'Provider B', passwordHash });
await createUser({ practiceId: a.id, email: 'a@test.example', name: 'Provider A', passwordHash });
const [alpha, alphaTwo] = await withPractice(a.id, async (scoped) => [
  await createPatient(scoped, samplePatient({ given: ['Ada'], family: 'Alpha' })),
  await createPatient(scoped, samplePatient({ given: ['Abe'], family: 'Alpha' })),
]);
const bravo = await withPractice(b.id, (scoped) => createPatient(scoped, samplePatient({ given: ['Bo'], family: 'Bravo' })));

let server;
let baseUrl;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server.close();
  await drop();
});

// Logs in and returns a function that sends requests with that session.
async function loginAs(email) {
  const res = await fetch(`${baseUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  assert.equal(res.status, 200);
  // Read the whole response, as the front end does: express-session sends the
  // headers before it finishes saving the session, and the body after. Using
  // the cookie straight from the headers could beat the save and get a 401.
  await res.json();
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (method, path, { body, headers } = {}) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { cookie, ...(body && { 'Content-Type': 'application/json' }), ...headers },
      body: body && JSON.stringify(body),
    });
}

const ids = (patients) => patients.map((p) => p.id).sort();

test('every patient route needs a login', async () => {
  for (const [method, path] of [
    ['POST', '/patients/_search'],
    ['GET', '/patients/_recent'],
    ['GET', `/patients/${alpha.id}`],
    ['POST', '/patients'],
    ['PUT', `/patients/${alpha.id}`],
    ['DELETE', `/patients/${alpha.id}`],
    ['POST', '/patients/_import'],
  ]) {
    const res = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('login tells the front end which practice the provider is in', async () => {
  const res = await fetch(`${baseUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'B@TEST.example', password: TEST_PASSWORD }),
  });
  const user = await res.json();
  assert.equal(user.practiceId, b.id);
  assert.equal(user.practiceName, 'Practice B');
});

test('searches return only the provider’s own practice', async () => {
  const asA = await loginAs('a@test.example');
  const asB = await loginAs('b@test.example');

  const byStatusA = await (await asA('POST', '/patients/_search', { body: { status: 'active' } })).json();
  assert.deepEqual(ids(byStatusA.patients), ids([alpha, alphaTwo]));

  const byStatusB = await (await asB('POST', '/patients/_search', { body: { status: 'active' } })).json();
  assert.deepEqual(ids(byStatusB.patients), [bravo.id]);

  const byName = await (await asB('POST', '/patients/_search', { body: { search: 'alpha' } })).json();
  assert.equal(byName.total, 0);
});

test("another practice's patient is 'not found' for reading, editing and deleting", async () => {
  const asB = await loginAs('b@test.example');
  const body = samplePatient({ family: 'Hijacked' });

  assert.equal((await asB('GET', `/patients/${alpha.id}`)).status, 404);
  assert.equal((await asB('PUT', `/patients/${alpha.id}`, { body })).status, 404);
  // A correct version check doesn't help either: the patient isn't theirs.
  const withIfMatch = { body, headers: { 'If-Match': `"${alpha.updatedAt.toISOString()}"` } };
  assert.equal((await asB('PUT', `/patients/${alpha.id}`, withIfMatch)).status, 404);
  assert.equal((await asB('DELETE', `/patients/${alpha.id}`)).status, 404);

  // Same answer as an id that doesn't exist, so it doesn't reveal the patient.
  assert.equal((await asB('GET', '/patients/999999')).status, 404);

  const asA = await loginAs('a@test.example');
  const unchanged = await (await asA('GET', `/patients/${alpha.id}`)).json();
  assert.equal(unchanged.name.family, 'Alpha');
  assert.equal(unchanged.status, 'active');
});

test('CSV import only matches patients in the provider’s own practice', async () => {
  const asA = await loginAs('a@test.example');
  const asB = await loginAs('b@test.example');
  const body = { dryRun: true, patients: [samplePatient({ given: ['Ada'], family: 'Alpha' })] };

  const planA = await (await asA('POST', '/patients/_import', { body })).json();
  assert.deepEqual(planA.alreadyImported, [0]);

  const planB = await (await asB('POST', '/patients/_import', { body })).json();
  assert.deepEqual(planB.ready, [0], 'practice B has no such patient, so nothing to match');
});

test('recent patients only include the provider’s own practice', async () => {
  const asB = await loginAs('b@test.example');
  await asB('GET', `/patients/${bravo.id}`);
  await asB('GET', `/patients/${alpha.id}`); // refused, so never "opened"
  const { patients } = await (await asB('GET', '/patients/_recent')).json();
  assert.deepEqual(ids(patients), [bravo.id]);
});

test('audit entries record the provider’s practice', async () => {
  const asB = await loginAs('b@test.example');
  await asB('POST', '/patients/_search', { body: { search: 'bravo' } });
  const { rows } = await pool.query('SELECT DISTINCT practice_id FROM audit_log WHERE user_id = $1', [userB.id]);
  assert.deepEqual(rows, [{ practice_id: b.id }]);
});

test('of two simultaneous saves from the same version, one wins and one gets 412', async () => {
  const asA = await loginAs('a@test.example');
  const current = await (await asA('GET', `/patients/${alphaTwo.id}`)).json();
  const save = () => asA('PUT', `/patients/${alphaTwo.id}`, { body: current, headers: { 'If-Match': `"${current.updatedAt}"` } });
  const statuses = (await Promise.all([save(), save()])).map((res) => res.status).sort();
  assert.deepEqual(statuses, [200, 412]);
});

test("a deleted patient can't be read, edited back to life, or deleted again", async () => {
  const asA = await loginAs('a@test.example');
  const doomed = await (await asA('POST', '/patients', { body: samplePatient({ family: 'Gone' }) })).json();
  assert.equal((await asA('DELETE', `/patients/${doomed.id}`)).status, 204);

  assert.equal((await asA('GET', `/patients/${doomed.id}`)).status, 404);
  assert.equal((await asA('PUT', `/patients/${doomed.id}`, { body: doomed })).status, 404);
  assert.equal((await asA('DELETE', `/patients/${doomed.id}`)).status, 404);
});

test('search-first: no listing without a 2-character search or a status', async () => {
  const asA = await loginAs('a@test.example');
  assert.equal((await asA('POST', '/patients/_search', { body: {} })).status, 400);
  assert.equal((await asA('POST', '/patients/_search', { body: { search: 'a' } })).status, 400);
  assert.equal((await asA('POST', '/patients/_search', { body: { search: 'al' } })).status, 200);
});

test('search requests are checked: page numbers, page sizes and types', async () => {
  const asA = await loginAs('a@test.example');
  const search = (body) => asA('POST', '/patients/_search', { body });

  for (const body of [
    { search: 'alpha', page: 0 },
    { search: 'alpha', pageSize: 101 },
    { search: 'alpha', pageSize: 0 },
    { search: 'alpha', page: 1.5 },
    { search: 42 },
    { status: 7 },
  ]) {
    assert.equal((await search(body)).status, 400, JSON.stringify(body));
  }

  const result = await (await search({ search: 'alpha', page: 1, pageSize: 1 })).json();
  assert.equal(result.patients.length, 1);
  assert.equal(result.total, 2);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 1);
});

test('a last name is required; the first name is optional, for patients with one name', async () => {
  const asA = await loginAs('a@test.example');
  const add = (name) => asA('POST', '/patients', { body: { ...samplePatient(), name } });

  const noLastName = await add({ given: ['Ada'], family: '' });
  assert.equal(noLastName.status, 400);
  assert.deepEqual((await noLastName.json()).errors, { 'name.family': 'Last name is required' });

  const singleName = await add({ given: [], family: 'Wulandari' });
  assert.equal(singleName.status, 201);
  assert.equal((await singleName.json()).name.text, 'Wulandari');

  const middleWithoutFirst = await add({ given: ['', 'Lee'], family: 'Chen' });
  assert.equal(middleWithoutFirst.status, 400);
  assert.deepEqual((await middleWithoutFirst.json()).errors, { 'name.given': 'Enter a first name before any middle names' });
});
