import { useEffect, useState } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { api } from './api.js';
import PatientTable from './PatientTable.jsx';

// The provider's own recently opened, added or edited patients, shown before
// they search (PRODUCT.md §6). `refreshKey` changes after a save, so an
// edited patient moves to the top.
export default function RecentPatients({ refreshKey, statuses, onOpen }) {
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

  if (error) {
    return (
      <Text size="sm" c="dimmed">
        {error}
      </Text>
    );
  }
  // Nothing until loaded, and nothing for a provider with no recent patients:
  // the search prompt above is enough.
  if (!patients?.length) return null;

  return (
    <Stack gap="xs">
      <Title order={2} size="h4">
        Your recent patients
      </Title>
      <PatientTable patients={patients} statuses={statuses} onOpen={onOpen} />
    </Stack>
  );
}
