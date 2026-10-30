// Sorts the rows of a CSV import before anything is saved (PRODUCT.md §8).
// Pure, so the route can use it both for the preview and the real import.

// Case is ignored: "SMITH" in a spreadsheet is the same as "Smith" on file.
const key = (values) => JSON.stringify(values).toLowerCase();

// Likely the same person: first name, family name and date of birth.
const personKey = ({ name, birthDate }) => key([name.given[0], name.family, birthDate]);

// The same record: every field a CSV can set, except status, which providers
// change after importing. A row matching this was imported before.
const recordKey = ({ name, preferredName, birthDate, address }) =>
  key([
    name.prefix, name.given, name.family, name.suffix, preferredName, birthDate,
    address.line, address.city, address.state, address.postalCode,
  ]);

// `rows` are parsePatient results in file order; `existing` are the current
// patients born on any of the rows' birth dates. Rows are referred to by
// their index in `rows`.
// - invalid: failed validation (skipped)
// - alreadyImported: exactly matches a patient on file (skipped)
// - duplicates: same person as a patient on file (matchesIndex null) or as an
//   earlier row (imported only if the provider confirms)
// - ready: new patients
// matchedIds are the patients on file that rows matched, for the audit log.
export function planImport(rows, existing) {
  const existingRecords = new Map(existing.map((p) => [recordKey(p), p.id]));
  const existingPeople = new Map(existing.map((p) => [personKey(p), p.id]));
  const earlierRows = new Map(); // personKey -> index of the first row with it
  const plan = { ready: [], alreadyImported: [], duplicates: [], invalid: [] };
  const matchedIds = new Set();

  rows.forEach(({ data, errors }, index) => {
    if (errors) {
      plan.invalid.push({ index, errors });
      return;
    }
    const record = recordKey(data);
    if (existingRecords.has(record)) {
      plan.alreadyImported.push(index);
      matchedIds.add(existingRecords.get(record));
      return;
    }
    const person = personKey(data);
    if (existingPeople.has(person)) {
      plan.duplicates.push({ index, matchesIndex: null });
      matchedIds.add(existingPeople.get(person));
    } else if (earlierRows.has(person)) {
      plan.duplicates.push({ index, matchesIndex: earlierRows.get(person) });
    } else {
      plan.ready.push(index);
    }
    if (!earlierRows.has(person)) earlierRows.set(person, index);
  });

  return { ...plan, matchedIds: [...matchedIds] };
}
