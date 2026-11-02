import { useEffect, useState } from 'react';
import { Button, Center, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { api } from './api.js';
import PatientTable from './PatientTable.jsx';

// The provider's own recently opened, added or edited patients, shown only
// when they ask for them (PRODUCT.md §6). `refreshKey` changes after a save,
// so an edited patient moves to the top.
export default function RecentPatients({ refreshKey, statuses, onOpen, onHide }) {
  const [result, setResult] = useState({ patients: null, error: '' });
  const { patients, error } = result;

  useEffect(() => {
    const controller = new AbortController();
    api('GET', '/patients/_recent', { signal: controller.signal })
      .then((data) => setResult({ patients: data.patients, error: '' }))
      .catch((err) => {
        if (err.name === 'AbortError' || err.status === 401) return;
        setResult({ patients: null, error: "Couldn't load your recent patients." });
      });
    return () => controller.abort();
  }, [refreshKey]);

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2} size="h4">
            Your recent patients
          </Title>
          <Text size="sm" c="dimmed">
            Patients you’ve opened, added or edited in the last 30 days, most recent first.
          </Text>
        </div>
        <Button variant="subtle" size="xs" onClick={onHide}>
          Hide
        </Button>
      </Group>
      {error ? (
        <Text size="sm" c="dimmed">
          {error}
        </Text>
      ) : !patients ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : patients.length === 0 ? (
        <Text size="sm" c="dimmed">
          No patients opened, added or edited in the last 30 days.
        </Text>
      ) : (
        <PatientTable patients={patients} statuses={statuses} onOpen={onOpen} />
      )}
    </Stack>
  );
}
