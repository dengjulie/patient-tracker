// Unit tests for turning spreadsheet rows into patients (csvImport.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessMapping, toPatient } from '../src/csvImport.js';

const reference = {
  statuses: [
    { code: 'active', label: 'Active' },
    { code: 'onhold', label: 'On hold' },
  ],
  states: [
    { code: 'MA', name: 'Massachusetts' },
    { code: 'NM', name: 'New Mexico' },
  ],
};

const headers = ['First Name', 'Middle', 'Surname', 'DOB', 'Status', 'Street Address', 'Apt', 'City', 'State', 'ZIP Code', 'Insurance'];
const mapping = guessMapping(headers);
const patientFrom = (cells) => toPatient(cells, mapping, reference);
const cells = (overrides = {}) => {
  const row = { first: 'Ada', middle: '', family: 'Lovelace', dob: '1990-01-02', status: 'active', street: '1 Main St', unit: '', city: 'Boston', state: 'MA', zip: '02134', insurance: 'Aetna', ...overrides };
  return [row.first, row.middle, row.family, row.dob, row.status, row.street, row.unit, row.city, row.state, row.zip, row.insurance];
};

test('common header names are matched to fields; others are left unmapped', () => {
  assert.deepEqual(mapping, {
    first: '0', middle: '1', family: '2', birthDate: '3', status: '4',
    street: '5', unit: '6', city: '7', state: '8', postalCode: '9',
  });
});

test('US dates become ISO dates; anything else is left for the server to explain', () => {
  assert.equal(patientFrom(cells({ dob: '3/12/1984' })).birthDate, '1984-03-12');
  assert.equal(patientFrom(cells({ dob: '1984-03-12' })).birthDate, '1984-03-12');
  assert.equal(patientFrom(cells({ dob: '3/12/84' })).birthDate, '3/12/84');
});

test('ZIPs get back the leading zeros a spreadsheet dropped', () => {
  assert.equal(patientFrom(cells({ zip: '2134' })).address.postalCode, '02134');
  assert.equal(patientFrom(cells({ zip: '501' })).address.postalCode, '00501');
  assert.equal(patientFrom(cells({ zip: '2134-1234' })).address.postalCode, '02134-1234');
  assert.equal(patientFrom(cells({ zip: '70' })).address.postalCode, '70', 'too short to be a ZIP');
});

test('state names and status labels become codes, in any case', () => {
  const patient = patientFrom(cells({ state: 'new mexico', status: 'On hold' }));
  assert.equal(patient.address.state, 'NM');
  assert.equal(patient.status, 'onhold');
  assert.equal(patientFrom(cells({ state: 'Ontario' })).address.state, 'Ontario', 'unknown, for the server to reject');
});

test('the first name stays whole and middle names split on spaces', () => {
  const { name } = patientFrom(cells({ first: 'Mary Ann', middle: 'Jo  Lee' }));
  assert.deepEqual(name.given, ['Mary Ann', 'Jo', 'Lee']);
});

test('unmapped fields are blank, and values are trimmed', () => {
  const patient = patientFrom(cells({ city: '  Boston ' }));
  assert.equal(patient.address.city, 'Boston');
  assert.equal(patient.preferredName, '');
  assert.equal(patient.name.suffix, '');
});
