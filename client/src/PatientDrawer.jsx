import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Center, Drawer, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { api } from './api.js';
import { STATUS_COLORS, age, displayName, formatDate, formatTimestamp } from './format.js';
import PatientForm from './PatientForm.jsx';

// The patient side panel (PRODUCT.md §6): one drawer that shows a patient
// read-only, or the add/edit form in its place.
// - `patientId`: the patient being viewed, or null when adding.
// - `editing`: undefined = viewing, null = adding, a patient = editing it.
// - `refreshKey` changes after a save, to load the saved copy.
// The patient is fetched here, not in the view, so switching to the form and
// back doesn't fetch again (or log another read).
export default function PatientDrawer({
  patientId,
  editing,
  refreshKey,
  reference,
  onEdit,
  onCancelEdit,
  onClose,
  onSaved,
  onDeleted,
  onStale,
}) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const isEditing = editing !== undefined;
  // While saving or deleting, the panel can't be closed: the change would
  // still go through, and an error would have nowhere to show.
  const [submitting, setSubmitting] = useState(false);

  // Fetched from GET /api/patients/:id rather than taken from the list, so
  // opening a patient is logged as a "read". As in the list, each result
  // remembers which request it answers, so "loading" is derived.
  const requestKey = `${patientId}:${refreshKey}`;
  const [result, setResult] = useState({ requestKey: null, patient: null, error: '' });
  const loading = result.requestKey !== requestKey;
  const { patient, error } = result;

  useEffect(() => {
    if (patientId === null) return;
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

  // From the edit form, closing goes back to the patient it was opened from.
  const handleClose = isEditing && patientId !== null ? onCancelEdit : onClose;

  return (
    <Drawer
      opened
      onClose={handleClose}
      position="right"
      size={isMobile ? '100%' : 'lg'}
      title={<Text fw={600} size="lg">{!isEditing ? 'Patient' : editing ? 'Edit patient' : 'Add patient'}</Text>}
      closeOnClickOutside={!isEditing} // a stray click shouldn't throw away typing
      closeOnEscape={!submitting}
      closeButtonProps={{ disabled: submitting }}
    >
      {isEditing ? (
        <PatientForm
          key={editing?.id ?? 'new'}
          patient={editing}
          reference={reference}
          submitting={submitting}
          setSubmitting={setSubmitting}
          onCancel={handleClose}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onStale={onStale}
        />
      ) : error ? (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      ) : loading && !patient ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <PatientDetails patient={patient} statuses={reference.statuses} onEdit={onEdit} />
      )}
    </Drawer>
  );
}

function PatientDetails({ patient, statuses, onEdit }) {
  const status = statuses.find((s) => s.code === patient.status);
  return (
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
