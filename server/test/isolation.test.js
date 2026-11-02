// Integration tests for practice isolation in the database itself: the
// practice filters in db.js, and Postgres row-level security and role
// permissions underneath them (ARCHITECTURE.md → Practice isolation).
// Several tests send raw SQL with no practice filter on purpose, to show
// that the database refuses other practices' rows on its own.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTestDatabase, samplePatient } from './setup.js';

const { db, drop } = await useTestDatabase();
after(drop);

const { pool, transaction, withPractice, findOrCreatePractice, createPatient, listPatients, findPatient, updatePatient, markEnteredInError } = db;

const { practice: a } = await findOrCreatePractice('Practice A');
const { practice: b } = await findOrCreatePractice('Practice B');
const patientA = await withPractice(a.id, (scoped) => createPatient(scoped, samplePatient({ family: 'Alpha' })));
const patientB = await withPractice(b.id, (scoped) => createPatient(scoped, samplePatient({ family: 'Bravo' })));

test("a practice's list holds only its own patients", async () => {
  const { patients } = await withPractice(a.id, (scoped) => listPatients(scoped));
  assert.deepEqual(patients.map((p) => p.id), [patientA.id]);
});

test("another practice's patient can't be found, edited or deleted by id", async () => {
  await withPractice(a.id, async (scoped) => {
    assert.equal(await findPatient(scoped, patientB.id), undefined);
    assert.equal(await updatePatient(scoped, patientB.id, samplePatient({ family: 'Changed' })), undefined);
    assert.equal(await markEnteredInError(scoped, patientB.id), false);
  });
  const stillThere = await withPractice(b.id, (scoped) => findPatient(scoped, patientB.id));
  assert.equal(stillThere.name.family, 'Bravo');
});

test('row-level security hides other practices even from a query with no practice filter', async () => {
  const { rows } = await withPractice(a.id, (scoped) => scoped.query('SELECT practice_id FROM patients'));
  assert.deepEqual(rows, [{ practice_id: a.id }]);
});

test('with no practice set, the app role sees no patients at all', async () => {
  const { rows } = await transaction(async (client) => {
    await client.query('SET LOCAL ROLE patient_tracker_app');
    return client.query('SELECT count(*)::int AS n FROM patients');
  });
  assert.equal(rows[0].n, 0);
});

test("a patient can't be added to another practice", async () => {
  await assert.rejects(
    withPractice(a.id, (scoped) =>
      scoped.query(
        `INSERT INTO patients (practice_id, name_text, birth_date, status, address_line1, city, state, postal_code)
         VALUES ($1, 'Smuggled', '1990-01-01', 'active', '1 St', 'Boston', 'MA', '02134')`,
        [b.id]
      )
    ),
    /row-level security/
  );
});

test("a patient can't be moved into another practice", async () => {
  await assert.rejects(
    withPractice(a.id, (scoped) => scoped.query('UPDATE patients SET practice_id = $1 WHERE id = $2', [b.id, patientA.id])),
    /row-level security/
  );
});

test('the app role cannot hard-delete patients', async () => {
  await assert.rejects(
    withPractice(a.id, (scoped) => scoped.query('DELETE FROM patients WHERE id = $1', [patientA.id])),
    /permission denied for table patients/
  );
});

test('the app role cannot change or delete audit entries', async () => {
  await assert.rejects(
    withPractice(a.id, (scoped) => scoped.query(`UPDATE audit_log SET action = 'login'`)),
    /permission denied for table audit_log/
  );
  await assert.rejects(
    withPractice(a.id, (scoped) => scoped.query('DELETE FROM audit_log')),
    /permission denied for table audit_log/
  );
});

test('the role and practice end with the transaction, so they never leak to the next query', async () => {
  await withPractice(a.id, (scoped) => listPatients(scoped));
  // Run on every pooled connection, so the one just used is among them.
  const clients = await Promise.all(Array.from({ length: pool.totalCount }, () => pool.connect()));
  try {
    for (const client of clients) {
      const { rows } = await client.query(
        `SELECT current_user, session_user, current_setting('app.practice_id', true) AS practice`
      );
      assert.equal(rows[0].current_user, rows[0].session_user, 'back to the login user, not the app role');
      assert.ok(!rows[0].practice, 'no practice left set');
    }
  } finally {
    clients.forEach((client) => client.release());
  }
});

test('patient queries refuse to run without a practice', async () => {
  await assert.rejects(withPractice(undefined, (scoped) => listPatients(scoped)), /needs a practice id/);
});
