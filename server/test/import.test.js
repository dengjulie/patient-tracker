// Unit tests for planImport, which sorts CSV rows before anything is saved
// (PRODUCT.md §8). Pure: no database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planImport } from '../import.js';
import { samplePatient } from './setup.js';

const onFile = { id: 7, ...samplePatient({ given: ['Ada'], family: 'Lovelace', birthDate: '1990-01-02' }) };
const row = (overrides) => ({ data: samplePatient({ given: ['Ada'], family: 'Lovelace', birthDate: '1990-01-02', ...overrides }) });

test('a row that failed validation is invalid, with its errors', () => {
  const errors = { 'address.postalCode': 'Use a 5-digit ZIP (or ZIP+4)' };
  const plan = planImport([{ errors }], []);
  assert.deepEqual(plan.invalid, [{ index: 0, errors }]);
  assert.deepEqual(plan.ready, []);
});

test('a row exactly matching a patient on file was already imported', () => {
  const plan = planImport([row()], [onFile]);
  assert.deepEqual(plan.alreadyImported, [0]);
  assert.deepEqual(plan.matchedIds, [7]);
});

test('the exact match ignores case and status', () => {
  const shouted = row({ given: ['ADA'], family: 'LOVELACE' });
  shouted.data.status = 'waitlist';
  assert.deepEqual(planImport([shouted], [onFile]).alreadyImported, [0]);
});

test('same name and birth date but a different address is a possible duplicate', () => {
  const plan = planImport([row({ street: '9 Other Rd' })], [onFile]);
  assert.deepEqual(plan.duplicates, [{ index: 0, matchesIndex: null }]);
  assert.deepEqual(plan.matchedIds, [7]);
});

test('middle names are ignored when looking for duplicates', () => {
  const plan = planImport([row({ given: ['Ada', 'Augusta'] })], [onFile]);
  assert.deepEqual(plan.duplicates, [{ index: 0, matchesIndex: null }]);
});

test('a second row for the same person in the file points at the first', () => {
  const plan = planImport([row(), row({ street: '9 Other Rd' })], []);
  assert.deepEqual(plan.ready, [0]);
  assert.deepEqual(plan.duplicates, [{ index: 1, matchesIndex: 0 }]);
});

test('anyone else is ready to import', () => {
  const plan = planImport([row({ given: ['Grace'], family: 'Hopper' })], [onFile]);
  assert.deepEqual(plan.ready, [0]);
  assert.deepEqual(plan.matchedIds, []);
});
