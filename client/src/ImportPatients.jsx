import { useState } from 'react';
import Papa from 'papaparse';
import { Alert, Button, Checkbox, FileInput, Group, List, Modal, ScrollArea, Select, Stack, Table, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { api } from './api.js';
import { IMPORT_FIELDS, MAX_IMPORT_ROWS, guessMapping, toPatient } from './csvImport.js';

const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

// Importing patients from a CSV file, in three steps (PRODUCT.md §8):
// 1. choose a file, 2. match its columns to our fields, 3. review what the
// server will do with each row, then import.
export default function ImportPatients({ reference, onClose, onImported }) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  // { fileName, headers, records: [{ rowNumber, cells }] }, rowNumber as the spreadsheet shows it
  const [csv, setCsv] = useState(null);
  const [mapping, setMapping] = useState({}); // { fieldKey: column index }
  const [plan, setPlan] = useState(null); // the server's dry run, for review
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function readFile(file) {
    setError('');
    if (!file) return;
    Papa.parse(file, {
      complete: ({ data }) => {
        const [headers = [], ...rows] = data;
        // Row 1 holds the headings. Blank rows are dropped, but every row keeps
        // its spreadsheet number so problems can be found in the file.
        const records = rows
          .map((cells, i) => ({ rowNumber: i + 2, cells }))
          .filter(({ cells }) => cells.some((cell) => cell.trim()));
        if (!records.length) {
          setError('This file has no patient rows. The first row should hold the column headings.');
        } else if (records.length > MAX_IMPORT_ROWS) {
          setError(`This file has ${plural(records.length, 'row')}. Import up to ${MAX_IMPORT_ROWS.toLocaleString()} at a time.`);
        } else {
          setCsv({ fileName: file.name, headers, records });
          setMapping(guessMapping(headers));
        }
      },
      error: () => setError("Couldn't read this file. Save it as CSV and try again."),
    });
  }

  const patients = csv ? csv.records.map((record) => toPatient(record.cells, mapping, reference)) : [];
  const unmapped = IMPORT_FIELDS.filter((field) => field.required && !mapping[field.key]);

  // Sends the rows: as a dry run to get the plan, or for real to import.
  async function send(dryRun) {
    setSubmitting(true);
    setError('');
    try {
      const result = await api('POST', '/patients/_import', { body: { patients, dryRun, includeDuplicates } });
      if (dryRun) {
        setPlan(result);
        setIncludeDuplicates(false);
      } else {
        const skipped = result.invalid.length + result.alreadyImported.length + (includeDuplicates ? 0 : result.duplicates.length);
        onImported({ created: result.created, skipped });
      }
    } catch (err) {
      if (err.status !== 401) setError('Something went wrong. Please try again.');
    }
    setSubmitting(false);
  }

  // "Row 5: Jane Doe", to find the row in the spreadsheet.
  function rowLabel(index) {
    const { name } = patients[index];
    const fullName = [...name.given, name.family].filter(Boolean).join(' ') || 'No name';
    return `Row ${csv.records[index].rowNumber}: ${fullName}`;
  }

  const importCount = plan ? plan.ready.length + (includeDuplicates ? plan.duplicates.length : 0) : 0;

  return (
    <Modal
      opened
      onClose={onClose}
      title={<Text fw={600} size="lg">Import patients from CSV</Text>}
      size="xl"
      fullScreen={isMobile}
      closeOnClickOutside={false}
      closeOnEscape={!submitting}
      closeButtonProps={{ disabled: submitting }}
    >
      <Stack gap="lg">
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        {!csv && (
          <FileInput
            label="CSV file"
            description="The first row should hold column headings. Export from Excel or Google Sheets as CSV."
            placeholder="Choose a file"
            accept=".csv,text/csv"
            onChange={readFile}
            data-autofocus
          />
        )}

        {csv && !plan && (
          <>
            <Text size="sm">
              Match the columns in <b>{csv.fileName}</b> ({plural(csv.records.length, 'row')}) to the patient fields.
              Columns you don't choose are not imported.
            </Text>
            <Table.ScrollContainer minWidth={560}>
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Patient field</Table.Th>
                    <Table.Th>Column in your file</Table.Th>
                    <Table.Th>Row {csv.records[0].rowNumber}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {IMPORT_FIELDS.map((field) => (
                    <Table.Tr key={field.key}>
                      <Table.Td>
                        {field.label}
                        {field.required && <Text span c="red"> *</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Select
                          aria-label={`Column for ${field.label}`}
                          placeholder="Not imported"
                          data={csv.headers.map((header, i) => ({ value: String(i), label: header.trim() || `Column ${i + 1}` }))}
                          value={mapping[field.key] ?? null}
                          onChange={(column) => setMapping((prev) => ({ ...prev, [field.key]: column }))}
                          clearable
                        />
                      </Table.Td>
                      <Table.Td c="dimmed" fz="sm">
                        {mapping[field.key] && csv.records[0].cells[Number(mapping[field.key])]}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {unmapped.length > 0 && (
              <Text size="sm" c="dimmed">
                Choose a column for: {unmapped.map((field) => field.label).join(', ')}.
              </Text>
            )}
            <Group justify="space-between">
              <Button variant="default" onClick={() => setCsv(null)} disabled={submitting}>
                Choose another file
              </Button>
              <Button onClick={() => send(true)} loading={submitting} disabled={unmapped.length > 0}>
                Review import
              </Button>
            </Group>
          </>
        )}

        {plan && (
          <>
            <Text>
              <b>{plural(plan.ready.length, 'new patient')}</b> ready to import.
            </Text>

            {plan.alreadyImported.length > 0 && (
              <Text size="sm">
                {plural(plan.alreadyImported.length, 'row')} already in the patient list will be skipped.
              </Text>
            )}

            {plan.duplicates.length > 0 && (
              <Alert color="yellow" variant="light" title={`Possible duplicates (${plan.duplicates.length})`}>
                <Stack gap="sm">
                  <Text size="sm">
                    These rows have the same name and date of birth as another patient, but other details differ.
                  </Text>
                  <RowList>
                    {plan.duplicates.map(({ index, matchesIndex }) => (
                      <List.Item key={index}>
                        {rowLabel(index)}, same as{' '}
                        {matchesIndex === null ? 'a patient already in the list' : `row ${csv.records[matchesIndex].rowNumber}`}
                      </List.Item>
                    ))}
                  </RowList>
                  <Checkbox
                    label={`Import ${plan.duplicates.length === 1 ? 'this row' : `these ${plan.duplicates.length} rows`} too`}
                    checked={includeDuplicates}
                    onChange={(e) => setIncludeDuplicates(e.currentTarget.checked)}
                  />
                </Stack>
              </Alert>
            )}

            {plan.invalid.length > 0 && (
              <Alert color="red" variant="light" title={`${plural(plan.invalid.length, 'row')} with problems will be skipped`}>
                <Stack gap="sm">
                  <Text size="sm">
                    Fix them in your file and import it again. Rows already imported will be skipped then.
                  </Text>
                  <RowList>
                    {plan.invalid.map(({ index, errors }) => (
                      <List.Item key={index}>
                        {rowLabel(index)}: {Object.values(errors).join('. ')}
                      </List.Item>
                    ))}
                  </RowList>
                </Stack>
              </Alert>
            )}

            <Group justify="space-between">
              <Button variant="default" onClick={() => setPlan(null)} disabled={submitting}>
                Back
              </Button>
              <Button onClick={() => send(false)} loading={submitting} disabled={importCount === 0}>
                Import {plural(importCount, 'patient')}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

// A list that scrolls once it's long, so a big file can't push the buttons away.
function RowList({ children }) {
  return (
    <ScrollArea.Autosize mah={180}>
      <List size="sm" spacing={2}>
        {children}
      </List>
    </ScrollArea.Autosize>
  );
}
