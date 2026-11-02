import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Center, Container, Group, Loader, Pagination, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { api } from './api.js';
import { STATUS_COLORS, age, displayName, formatDate, formatTimestamp, formatUpdated } from './format.js';
import PatientForm from './PatientForm.jsx';
import PatientDrawer from './PatientDrawer.jsx';
import ImportPatients from './ImportPatients.jsx';

const SEARCH_DELAY_MS = 300;
const PAGE_SIZE = 25;
// Search-first (PRODUCT.md §6): no patients are shown until the provider types
// at least this much or picks a status. The server enforces the same rule.
const MIN_SEARCH_LENGTH = 2;

// Screen-reader names for the pagination arrows.
const PAGINATION_LABELS = { first: 'First page', previous: 'Previous page', next: 'Next page', last: 'Last page' };

export default function PatientsPage({ user, onLogout }) {
  const [reference, setReference] = useState({ statuses: [], states: [] });
  const { statuses } = reference;
  const [referenceError, setReferenceError] = useState('');
  // undefined = form closed, null = adding a patient, object = editing that patient
  const [editing, setEditing] = useState(undefined);
  const [viewingId, setViewingId] = useState(null); // the patient open in the view, if any
  const [importing, setImporting] = useState(false);
  // Bumped after a save or delete to reload the list, even if the query is unchanged.
  const [refreshCount, setRefreshCount] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(null);
  // Wait until typing pauses before searching, so we don't send (and audit-log)
  // a request on every keystroke.
  const [debouncedSearch] = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  // A status on its own counts as a search: it's a worklist ("everyone on
  // the waitlist"), not the whole patient list.
  const askedFor = Boolean(status) || search.trim().length >= MIN_SEARCH_LENGTH;
  // Results show only while the provider is asking for them, so clearing the
  // box hides them at once, without waiting for the debounce.
  const searching = askedFor && (Boolean(status) || debouncedSearch.length >= MIN_SEARCH_LENGTH);
  const filters = { search: debouncedSearch, status: status ?? '' };
  const filtersKey = JSON.stringify(filters);

  // The page number remembers which filters it was chosen for, so changing
  // the search or status filter goes back to page 1 automatically.
  const [pageChoice, setPageChoice] = useState({ filtersKey, page: 1 });
  const page = pageChoice.filtersKey === filtersKey ? pageChoice.page : 1;

  function goToPage(newPage) {
    setPageChoice({ filtersKey, page: newPage });
    window.scrollTo({ top: 0 });
  }

  // One string identifies a list request: the query, plus the refresh count so
  // a reload after a save is a new request even when the query is unchanged.
  // A string, so the effect below reruns only when it actually changes.
  const requestKey = JSON.stringify({ refreshCount, query: { ...filters, page, pageSize: PAGE_SIZE } });

  // Each result remembers which request it answers. We're loading whenever the
  // latest result is for an older request; the old rows stay visible meanwhile.
  const [result, setResult] = useState({ requestKey: null, data: null, error: '' });
  const loading = searching && result.requestKey !== requestKey;
  const error = searching ? result.error : '';
  const patients = searching ? (result.data?.patients ?? null) : null;
  const total = result.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    api('GET', '/reference')
      .then(setReference)
      .catch((err) => {
        // A 401 needs no message: the app returns to the login page.
        if (err.status !== 401) setReferenceError("Couldn't load the patient form. Please refresh the page.");
      });
  }, []);

  useEffect(() => {
    // Cancel the previous search when a new one starts, so a slow, older
    // response can never overwrite a newer one.
    const { query } = JSON.parse(requestKey);
    if (!query.status && query.search.length < MIN_SEARCH_LENGTH) return;
    const controller = new AbortController();
    api('POST', '/patients/_search', { body: query, signal: controller.signal })
      .then((data) => {
        setResult({ requestKey, data, error: '' });
        // Deleting the only patient on the last page leaves that page empty;
        // show the new last page instead.
        if (data.patients.length === 0 && data.page > 1) {
          setPageChoice((prev) => ({ ...prev, page: Math.max(1, Math.ceil(data.total / PAGE_SIZE)) }));
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setResult((prev) => ({ ...prev, requestKey, error: "Couldn't load patients. Please try again." }));
      });
    return () => controller.abort();
  }, [requestKey]);

  // After a change, reload the page the provider was on, keeping their place
  // and filters. The notification confirms the change.
  function reload() {
    setRefreshCount((n) => n + 1);
  }

  function handleSaved(patient, isNew) {
    setEditing(undefined);
    notifications.show({ color: 'green', title: isNew ? 'Patient added' : 'Changes saved', message: displayName(patient) });
    reload();
  }

  function handleDeleted(patient) {
    setEditing(undefined);
    setViewingId(null);
    notifications.show({ title: 'Patient deleted', message: `${displayName(patient)} was marked as entered in error.` });
    reload();
  }

  function handleImported({ created, skipped }) {
    setImporting(false);
    notifications.show({
      color: 'green',
      title: `Imported ${created} ${created === 1 ? 'patient' : 'patients'}`,
      message: skipped ? `${skipped} ${skipped === 1 ? 'row was' : 'rows were'} skipped.` : undefined,
    });
    reload();
  }

  const statusLabel = (code) => statuses.find((s) => s.code === code)?.label ?? code;
  const firstShown = (page - 1) * PAGE_SIZE + 1;
  const lastShown = firstShown + (patients?.length ?? 0) - 1;

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={1} size="h2">
              Patients
            </Title>
            {patients && (
              <Text c="dimmed" size="sm">
                {total} {total === 1 ? 'patient' : 'patients'} found
              </Text>
            )}
          </div>
          <Group gap="sm">
            <Text size="sm" c="dimmed">
              {user.name}
            </Text>
            <Button variant="default" onClick={onLogout}>
              Log out
            </Button>
            <Button variant="default" onClick={() => setImporting(true)} disabled={!statuses.length}>
              Import CSV
            </Button>
            <Button onClick={() => setEditing(null)} disabled={!statuses.length}>
              Add patient
            </Button>
          </Group>
        </Group>

        {/* The form needs the status and state lists for its dropdowns. */}
        {editing !== undefined && statuses.length > 0 && (
          <PatientForm
            patient={editing}
            reference={reference}
            onClose={() => setEditing(undefined)}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onStale={reload}
          />
        )}

        {/* Hidden while the edit form is open, so Escape closes only the form;
            it slides back afterwards. Reloads with the list after a save. */}
        {viewingId !== null && (
          <PatientDrawer
            opened={editing === undefined}
            patientId={viewingId}
            refreshKey={refreshCount}
            statuses={statuses}
            onEdit={setEditing}
            onClose={() => setViewingId(null)}
          />
        )}

        {importing && (
          <ImportPatients reference={reference} onClose={() => setImporting(false)} onImported={handleImported} />
        )}

        <Group align="flex-end" grow preventGrowOverflow={false}>
          <TextInput
            label="Search"
            placeholder="Name or date of birth (MM/DD/YYYY)"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            autoFocus
            rightSection={loading && patients ? <Loader size="xs" /> : null}
            style={{ flexGrow: 3 }}
          />
          <Select
            label="Status"
            placeholder="All statuses"
            data={statuses.map((s) => ({ value: s.code, label: s.label }))}
            value={status}
            onChange={setStatus}
            clearable
          />
        </Group>

        {[referenceError, error].filter(Boolean).map((message) => (
          <Alert key={message} color="red" variant="light">
            {message}
          </Alert>
        ))}

        {!askedFor ? (
          <Paper withBorder p="xl" radius="md">
            <Text ta="center" c="dimmed">
              {search.trim()
                ? `Keep typing: enter at least ${MIN_SEARCH_LENGTH} characters.`
                : 'Search by name or date of birth, or choose a status, to find patients.'}
            </Text>
          </Paper>
        ) : patients === null && !error ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : patients?.length === 0 ? (
          <Paper withBorder p="xl" radius="md">
            <Text ta="center" c="dimmed">
              No patients match your search.
            </Text>
          </Paper>
        ) : (
          patients && (
            <Paper withBorder radius="md">
              <Table.ScrollContainer minWidth={760}>
                <Table striped highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Date of birth</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>City, State</Table.Th>
                      <Table.Th>Updated</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {patients.map((patient) => (
                      // The whole row opens the patient for mouse users; the name is a
                      // real button so keyboard and screen-reader users can too. Its
                      // click (including Enter/Space) bubbles up to the row's handler.
                      <Table.Tr key={patient.id} onClick={() => setViewingId(patient.id)} style={{ cursor: 'pointer' }}>
                        <Table.Td>
                          <Anchor component="button" type="button" fw={500} c="inherit">
                            {displayName(patient)}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          {formatDate(patient.birthDate)}{' '}
                          <Text span c="dimmed" size="sm">
                            ({age(patient.birthDate)} yrs)
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={STATUS_COLORS[patient.status]} variant="light">
                            {statusLabel(patient.status)}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          {patient.address.city}, {patient.address.state}
                        </Table.Td>
                        <Table.Td c="dimmed" fz="sm">
                          <time dateTime={patient.updatedAt} title={formatTimestamp(patient.updatedAt)}>
                            {formatUpdated(patient.updatedAt)}
                          </time>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          )
        )}

        {pageCount > 1 && patients?.length > 0 && (
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Showing {firstShown}–{lastShown} of {total}
            </Text>
            <Pagination
              total={pageCount}
              value={page}
              onChange={goToPage}
              withEdges
              getControlProps={(control) => ({ 'aria-label': PAGINATION_LABELS[control] })}
              getItemProps={(item) => ({ 'aria-label': `Page ${item}` })}
            />
          </Group>
        )}
      </Stack>
    </Container>
  );
}
