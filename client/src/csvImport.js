// Turns spreadsheet rows into patients for POST /api/patients/_import
// (PRODUCT.md §8). The server validates them with the same rules as the form;
// this file only reshapes the provider's columns and fixes common spreadsheet
// formats.

export const MAX_IMPORT_ROWS = 5000; // the server's limit

// The fields a column can be mapped to, in the form's order. `headers` are
// common column names for the field (compared lowercase, letters and digits
// only), used to pre-select the mapping.
export const IMPORT_FIELDS = [
  { key: 'first', label: 'First (given) name', required: true, headers: ['first', 'firstname', 'givenname', 'given', 'fname'] },
  { key: 'middle', label: 'Middle name(s)', headers: ['middle', 'middlename', 'middlenames', 'mi', 'middleinitial'] },
  { key: 'family', label: 'Last (family) name', headers: ['last', 'lastname', 'familyname', 'family', 'surname', 'lname'] },
  { key: 'suffix', label: 'Suffix', headers: ['suffix'] },
  { key: 'prefix', label: 'Prefix', headers: ['prefix', 'title'] },
  { key: 'preferredName', label: 'Preferred name', headers: ['preferredname', 'preferred', 'nickname'] },
  { key: 'birthDate', label: 'Date of birth', required: true, headers: ['dob', 'dateofbirth', 'birthdate', 'birthday'] },
  { key: 'status', label: 'Status', required: true, headers: ['status'] },
  { key: 'street', label: 'Street', required: true, headers: ['street', 'address', 'address1', 'addressline1', 'streetaddress'] },
  { key: 'unit', label: 'Apt / unit', headers: ['unit', 'apt', 'apartment', 'suite', 'address2', 'addressline2'] },
  { key: 'city', label: 'City', required: true, headers: ['city'] },
  { key: 'state', label: 'State', required: true, headers: ['state', 'st'] },
  { key: 'postalCode', label: 'ZIP', required: true, headers: ['zip', 'zipcode', 'postalcode', 'postcode'] },
];

const simplify = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// Pre-selects a column for each field whose usual name appears in the file.
// Returns { fieldKey: column index as a string } (Select values are strings).
export function guessMapping(headers) {
  const simplified = headers.map(simplify);
  const mapping = {};
  for (const field of IMPORT_FIELDS) {
    const column = simplified.findIndex((header) => field.headers.includes(header) || header === simplify(field.label));
    if (column !== -1) mapping[field.key] = String(column);
  }
  return mapping;
}

// Excel and US spreadsheets write dates as 3/12/1984; the API takes 1984-03-12.
// Anything else is passed through for the server to accept or explain.
function toIsoDate(text) {
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : text;
}

// Spreadsheets treat ZIPs as numbers and drop leading zeros (02134 -> 2134).
// No US ZIP is shorter than 5 digits, so a 3- or 4-digit one lost its zeros.
const restoreZip = (text) => text.replace(/^\d{3,4}(?=(-\d{4})?$)/, (digits) => digits.padStart(5, '0'));

// Accepts a code or its name in any case: "CA" or "california"; "onhold" or "On hold".
function toCode(text, options, nameKey) {
  const match = options.find((option) => [option.code, option[nameKey]].some((name) => simplify(name) === simplify(text)));
  return match ? match.code : text;
}

// One spreadsheet row (an array of cells) -> a patient in the API's shape.
export function toPatient(cells, mapping, reference) {
  const value = (key) => (mapping[key] ? (cells[Number(mapping[key])] ?? '').trim() : '');
  return {
    name: {
      prefix: value('prefix'),
      // As in the form: the first name stays whole, middle names split on spaces.
      given: [value('first'), ...value('middle').split(/\s+/).filter(Boolean)],
      family: value('family'),
      suffix: value('suffix'),
    },
    preferredName: value('preferredName'),
    birthDate: toIsoDate(value('birthDate')),
    status: toCode(value('status'), reference.statuses, 'label'),
    address: {
      line: [value('street'), value('unit')],
      city: value('city'),
      state: toCode(value('state'), reference.states, 'name'),
      postalCode: restoreZip(value('postalCode')),
    },
  };
}
