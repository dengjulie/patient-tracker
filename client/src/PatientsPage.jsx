import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Center, Container, Group, Loader, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { api } from './api.js';
import { age, displayName, formatDate } from './format.js';

const SEARCH_DELAY_MS = 300;

const STATUS_COLORS = {
  planned: 'blue',
  waitlist: 'yellow',
  active: 'green',
  onhold: 'orange',
  finished: 'gray',
  cancelled: 'red',
};

export default function PatientsPage({ user, onLogout }) {
  const [statuses, setStatuses] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(null);
  // Wait until typing pauses before searching, so we don't send (and audit-log)
  // a request on every keystroke.
  const [debouncedSearch] = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const query = { search: debouncedSearch, status: status ?? '' };
  const queryKey = JSON.stringify(query);

  // Each result remembers which query it answers. We're loading whenever the
  // latest result is for an older query; the old rows stay visible meanwhile.
  const [result, setResult] = useState({ queryKey: null, patients: null, error: '' });
  const loading = result.queryKey !== queryKey;
  const { patients, error } = result;

  useEffect(() => {
    api('GET', '/reference').then((reference) => setStatuses(reference.statuses));
  }, []);

  useEffect(() => {
    // Cancel the previous search when a new one starts, so a slow, older
    // response can never overwrite a newer one.
    const controller = new AbortController();
    api('POST', '/patients/_search', { body: JSON.parse(queryKey), signal: controller.signal })
      .then((found) => setResult({ queryKey, patients: found, error: '' }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setResult((prev) => ({ ...prev, queryKey, error: "Couldn't load patients. Please try again." }));
      });
    return () => controller.abort();
  }, [queryKey]);

  const statusLabel = (code) => statuses.find((s) => s.code === code)?.label ?? code;
  const filtering = Boolean(query.search || query.status);

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
                {patients.length} {patients.length === 1 ? 'patient' : 'patients'}
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
          </Group>
        </Group>

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
              <Table.ScrollContainer minWidth={640}>
                <Table striped highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Date of birth</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>City, State</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {patients.map((patient) => (
                      <Table.Tr key={patient.id}>
                        <Table.Td fw={500}>{displayName(patient)}</Table.Td>
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
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          )
        )}
      </Stack>
    </Container>
  );
}
