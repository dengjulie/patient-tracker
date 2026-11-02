// Integration tests for finding patients (PRODUCT.md §6): sort order, the
// status filter, search by name and date of birth, combining them, and
// paging. Runs listPatients against a test database with known patients and
// known "last updated" times, so every expected result is exact.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTestDatabase, samplePatient } from './setup.js';

const { db, drop } = await useTestDatabase();
after(drop);

const { withPractice, findOrCreatePractice, createPatient, setPatientTimestamps, markEnteredInError, listPatients } = db;
const { practice } = await findOrCreatePractice('Search Practice');
const { practice: other } = await findOrCreatePractice('Other Practice');

const HOUR = 60 * 60 * 1000;
const now = Date.now();

// Adds a patient last updated `hoursAgo` hours ago. Returns its id.
async function addPatient(practiceId, hoursAgo, { prefix = '', given, family = '', suffix = '', preferredName = '', birthDate, status = 'active' }) {
  return withPractice(practiceId, async (scoped) => {
    const patient = samplePatient({ given, family, birthDate });
    Object.assign(patient, { preferredName, status });
    Object.assign(patient.name, { prefix, suffix });
    const created = await createPatient(scoped, patient);
    const updatedAt = new Date(now - hoursAgo * HOUR);
    await setPatientTimestamps(scoped, created.id, { createdAt: updatedAt, updatedAt });
    return created.id;
  });
}

const maria = await addPatient(practice.id, 1, { given: ['Maria', 'Elena'], family: 'Garcia', birthDate: '1984-03-12' });
const jose = await addPatient(practice.id, 2, { given: ['José'], family: 'Muñoz', birthDate: '1990-07-04', status: 'waitlist' });
const robert = await addPatient(practice.id, 3, {
  given: ['Robert', 'James'], family: 'Okafor', suffix: 'Jr.', preferredName: 'Bobby', birthDate: '1991-07-28', status: 'planned',
});
const wulandari = await addPatient(practice.id, 4, { given: ['Wulandari'], birthDate: '1969-06-06', status: 'waitlist' });
const priya = await addPatient(practice.id, 5, { prefix: 'Dr.', given: ['Priya'], family: 'Shah', birthDate: '1976-11-02', status: 'onhold' });
// Two patients updated at the same moment, for the tie-break.
const anaFirst = await addPatient(practice.id, 6, { given: ['Ana'], family: 'Tie', birthDate: '2000-01-01' });
const anaSecond = await addPatient(practice.id, 6, { given: ['Ana'], family: 'Tie', birthDate: '2000-01-02' });
// Deleted (entered in error): never listed.
const deleted = await addPatient(practice.id, 0, { given: ['Maria'], family: 'Deleted', birthDate: '1984-03-12' });
await withPractice(practice.id, (scoped) => markEnteredInError(scoped, deleted));
// Same name, other practice: never listed here.
await addPatient(other.id, 0, { given: ['Maria', 'Elena'], family: 'Garcia', birthDate: '1984-03-12' });

const everyoneNewestFirst = [maria, jose, robert, wulandari, priya, anaSecond, anaFirst];

// The ids listPatients returns, in order.
async function find(query) {
  const { patients } = await withPractice(practice.id, (scoped) => listPatients(scoped, query));
  return patients.map((p) => p.id);
}

// Sorting

test('patients are listed most recently updated first', async () => {
  assert.deepEqual(await find({}), everyoneNewestFirst);
});

test('patients updated at the same moment are ordered by newest id, so the order is stable', async () => {
  const tied = await find({ search: 'tie' });
  assert.deepEqual(tied, [anaSecond, anaFirst]);
});

test('deleted patients and other practices’ patients are never listed', async () => {
  const ids = await find({ search: 'maria' });
  assert.deepEqual(ids, [maria]);
});

// Status filter

test('a status lists only patients with that status, newest first', async () => {
  assert.deepEqual(await find({ status: 'waitlist' }), [jose, wulandari]);
  assert.deepEqual(await find({ status: 'onhold' }), [priya]);
  assert.deepEqual(await find({ status: 'finished' }), []);
});

test("the entered-in-error status can't be listed through the filter", async () => {
  assert.deepEqual(await find({ status: 'entered-in-error' }), []);
});

test('a status and a search together must both match', async () => {
  assert.deepEqual(await find({ status: 'waitlist', search: 'jose' }), [jose]);
  assert.deepEqual(await find({ status: 'active', search: 'jose' }), []);
});

// Search by name

test('name search ignores case and matches part of a name', async () => {
  assert.deepEqual(await find({ search: 'MARIA' }), [maria]);
  assert.deepEqual(await find({ search: 'gar' }), [maria]);
});

test('every word must match, in any order and any name part', async () => {
  assert.deepEqual(await find({ search: 'garcia maria' }), [maria]);
  assert.deepEqual(await find({ search: 'elena' }), [maria], 'middle names count');
  assert.deepEqual(await find({ search: 'maria okafor' }), [], 'words from two different patients');
});

test('search ignores accents both ways', async () => {
  assert.deepEqual(await find({ search: 'jose munoz' }), [jose]);
  assert.deepEqual(await find({ search: 'JOSÉ MUÑOZ' }), [jose]);
});

test('the preferred name, prefix and suffix are searchable', async () => {
  assert.deepEqual(await find({ search: 'bobby' }), [robert]);
  assert.deepEqual(await find({ search: 'jr' }), [robert]);
  assert.deepEqual(await find({ search: 'dr. shah' }), [priya]);
});

test('a patient with only one name can be found', async () => {
  assert.deepEqual(await find({ search: 'wulandari' }), [wulandari]);
});

test('% and _ are matched literally, not as wildcards', async () => {
  assert.deepEqual(await find({ search: '%' }), []);
  assert.deepEqual(await find({ search: '_' }), []);
});

// Search by date of birth

test('date of birth can be searched in US or ISO format', async () => {
  assert.deepEqual(await find({ search: '03/12/1984' }), [maria]);
  assert.deepEqual(await find({ search: '1984-03-12' }), [maria]);
});

test('part of a date of birth matches too', async () => {
  assert.deepEqual(await find({ search: '1984' }), [maria]);
  assert.deepEqual(await find({ search: '07/' }), [jose, robert], 'born in July');
});

test('a name and a date of birth together narrow to one patient', async () => {
  assert.deepEqual(await find({ search: 'ana 01/02/2000' }), [anaSecond]);
  assert.deepEqual(await find({ search: 'maria 1990' }), []);
});

// Paging

test('pages split the list without gaps or repeats, with a constant total', async () => {
  const seen = [];
  for (let page = 1; page <= 4; page += 1) {
    const result = await withPractice(practice.id, (scoped) => listPatients(scoped, { page, pageSize: 2 }));
    assert.equal(result.total, everyoneNewestFirst.length);
    seen.push(...result.patients.map((p) => p.id));
  }
  assert.deepEqual(seen, everyoneNewestFirst);
});

test('a page past the end is empty but still reports the total', async () => {
  const result = await withPractice(practice.id, (scoped) => listPatients(scoped, { page: 99, pageSize: 2 }));
  assert.deepEqual(result.patients, []);
  assert.equal(result.total, everyoneNewestFirst.length);
});

test('the total counts all matches, not just the page', async () => {
  const result = await withPractice(practice.id, (scoped) => listPatients(scoped, { status: 'waitlist', pageSize: 1 }));
  assert.equal(result.patients.length, 1);
  assert.equal(result.total, 2);
});
