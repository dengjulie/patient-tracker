import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Center, Drawer, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { api } from './api.js';
import { STATUS_COLORS, age, displayName, formatDate, formatTimestamp } from './format.js';

// Read-only view of one patient (PRODUCT.md §6). The record is fetched from
// GET /api/patients/:id rather than taken from the list, so opening it is
// logged as a "read". `refreshKey` changes after a save, to show the new copy.
export default function PatientDrawer({ opened, patientId, refreshKey, statuses, onEdit, onClose }) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const requestKey = `${patientId}:${refreshKey}`;
  // As in the list, each result remembers which request it answers, so
  // "loading" is derived instead of stored.
  const [result, setResult] = useState({ requestKey: null, patient: null, error: '' });
  const loading = result.requestKey !== requestKey;
  const { patient, error } = result;

  useEffect(() => {
    const controller = new AbortController();
    api('GET', `/patients/${patientId}`, { signal: controller.signal })
      .then((data) => setResult({ requestKey, patient: data, error: '' }))
      .catch((err) => {
        if (err.name === 'AbortError' || err.status === 401) return;
        const message = err.status === 404 ? 'This patient no longer exists.' : "Couldn't load this patient. Please try again.";
        setResult({ requestKey, patient: null, error: message });
      });
    return () => controller.abort();
  }, [patientId, requestKey]);

  const status = patient && statuses.find((s) => s.code === patient.status);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={isMobile ? '100%' : 'md'}
      title={<Text fw={600} size="lg">Patient</Text>}
    >
      {error ? (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      ) : loading && !patient ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <Stack gap="lg">
          <div>
            <Title order={2} size="h3">
              {displayName(patient)}
            </Title>
            <Group gap="xs" mt="xs">
              <Badge color={STATUS_COLORS[patient.status]} variant="light">
                {status?.label ?? patient.status}
              </Badge>
              <Text size="sm" c="dimmed">
                {status?.description}
              </Text>
            </Group>
          </div>

          <Field label="Date of birth">
            {formatDate(patient.birthDate)}{' '}
            <Text span c="dimmed">
              ({age(patient.birthDate)} yrs)
            </Text>
          </Field>

          <Field label="Address">
            {patient.address.line.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div>
              {patient.address.city}, {patient.address.state} {patient.address.postalCode}
            </div>
          </Field>

          <Field label="Record">
            <Text size="sm" c="dimmed">
              Added {formatTimestamp(patient.createdAt)}
              <br />
              Last updated {formatTimestamp(patient.updatedAt)}
            </Text>
          </Field>

          {/* The fetched copy carries the latest updatedAt, so the edit form's
              conflict check compares against what the provider just saw. */}
          <Group justify="flex-end">
            <Button onClick={() => onEdit(patient)}>Edit</Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Text size="sm" fw={500} c="dimmed">
        {label}
      </Text>
      <div>{children}</div>
    </div>
  );
}
