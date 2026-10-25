import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Center, Container, Group, Loader, Pagination, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { api } from './api.js';
import { age, displayName, formatDate, formatTimestamp, formatUpdated } from './format.js';
import PatientForm from './PatientForm.jsx';

const SEARCH_DELAY_MS = 300;
const PAGE_SIZE = 25;

// Screen-reader names for the pagination arrows.
const PAGINATION_LABELS = { first: 'First page', previous: 'Previous page', next: 'Next page', last: 'Last page' };

const STATUS_COLORS = {
  planned: 'blue',
  waitlist: 'yellow',
  active: 'green',
  onhold: 'orange',
  finished: 'gray',
  cancelled: 'red',
};

export default function PatientsPage({ user, onLogout }) {
  const [reference, setReference] = useState({ statuses: [], states: [] });
  const { statuses } = reference;
  // undefined = form closed, null = adding a patient, object = editing that patient
  const [editing, setEditing] = useState(undefined);
  // Bumped after a save or delete to reload the list, even if the query is unchanged.
  const [refreshCount, setRefreshCount] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(null);
  // Wait until typing pauses before searching, so we don't send (and audit-log)
  // a request on every keystroke.
  const [debouncedSearch] = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
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

  const queryKey = JSON.stringify({ ...filters, page, pageSize: PAGE_SIZE });
  const requestKey = `${refreshCount}|${queryKey}`;

  // Each result remembers which request it answers. We're loading whenever the
  // latest result is for an older request; the old rows stay visible meanwhile.
  const [result, setResult] = useState({ requestKey: null, data: null, error: '' });
  const loading = result.requestKey !== requestKey;
  const { error } = result;
  const patients = result.data?.patients ?? null;
  const total = result.data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    api('GET', '/reference').then(setReference);
  }, []);

  useEffect(() => {
    // Cancel the previous search when a new one starts, so a slow, older
    // response can never overwrite a newer one.
    const controller = new AbortController();
    api('POST', '/patients/_search', { body: JSON.parse(queryKey), signal: controller.signal })
      .then((data) => setResult({ requestKey, data, error: '' }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setResult((prev) => ({ ...prev, requestKey, error: "Couldn't load patients. Please try again." }));
      });
    return () => controller.abort();
  }, [requestKey, queryKey]);

  // After a change, show page 1: the list is newest first, so that's where the
  // added or edited patient now is.
  function reloadFromFirstPage() {
    setPageChoice({ filtersKey, page: 1 });
    setRefreshCount((n) => n + 1);
  }

  function handleSaved(patient, isNew) {
    setEditing(undefined);
    notifications.show({ color: 'green', title: isNew ? 'Patient added' : 'Changes saved', message: displayName(patient) });
    reloadFromFirstPage();
  }

  function handleDeleted(patient) {
    setEditing(undefined);
    notifications.show({ title: 'Patient deleted', message: `${displayName(patient)} was marked as entered in error.` });
    reloadFromFirstPage();
  }

  const statusLabel = (code) => statuses.find((s) => s.code === code)?.label ?? code;
  const filtering = Boolean(filters.search || filters.status);
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
                {total} {total === 1 ? 'patient' : 'patients'}
                {filtering && ' found'}
              </Text>
            )}
          </div>
          <Group gap="sm">
            <Text size="sm" c="dimmed">
              {user.name}
            </Text>
            <Button variant="default" size="xs" onClick={onLogout}>
              Log out
            </Button>
            <Button onClick={() => setEditing(null)} disabled={!statuses.length}>
              Add patient
            </Button>
          </Group>
        </Group>

        {editing !== undefined && (
          <PatientForm
            patient={editing}
            reference={reference}
            onClose={() => setEditing(undefined)}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onStale={() => setRefreshCount((n) => n + 1)}
          />
        )}

        <Group align="flex-end" grow preventGrowOverflow={false}>
          <TextInput
            label="Search"
            placeholder="Name or date of birth (MM/DD/YYYY)"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
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

        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}

        {patients === null && !error ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : patients?.length === 0 ? (
          <Paper withBorder p="xl" radius="md">
            <Text ta="center" c="dimmed">
              {filtering ? 'No patients match your search.' : 'No patients yet.'}
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
                      // real button so keyboard and screen-reader users can too.
                      <Table.Tr key={patient.id} onClick={() => setEditing(patient)} style={{ cursor: 'pointer' }}>
                        <Table.Td>
                          <Anchor component="button" type="button" fw={500} c="inherit" onClick={() => setEditing(patient)}>
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
