import { useState } from 'react';
import { Alert, Button, Fieldset, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { api } from './api.js';

const EMPTY_FORM = {
  name: { prefix: '', first: '', middle: '', family: '', suffix: '' },
  preferredName: '',
  birthDate: '',
  status: 'planned', // new patients start as Planned (PRODUCT.md §4)
  address: { street: '', unit: '', city: '', state: null, postalCode: '' },
};

// The form uses familiar fields (first / middle, street / unit); the API uses
// FHIR's lists (name.given[], address.line[]). These two functions convert.
function toFormValues(patient) {
  const { name, address } = patient;
  return {
    name: {
      prefix: name.prefix,
      first: name.given[0] ?? '',
      middle: name.given.slice(1).join(' '),
      family: name.family,
      suffix: name.suffix,
    },
    preferredName: patient.preferredName,
    birthDate: patient.birthDate,
    status: patient.status,
    address: {
      street: address.line[0] ?? '',
      unit: address.line[1] ?? '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
    },
  };
}

function toPayload(values) {
  const { name, address } = values;
  return {
    name: {
      prefix: name.prefix,
      // The first name stays whole ("Mary Ann"); middle names split on spaces.
      given: [name.first, ...name.middle.split(/\s+/)].map((n) => n.trim()).filter(Boolean),
      family: name.family,
      suffix: name.suffix,
    },
    preferredName: values.preferredName,
    birthDate: values.birthDate,
    status: values.status,
    address: {
      line: [address.street, address.unit],
      city: address.city,
      state: address.state ?? '',
      postalCode: address.postalCode,
    },
  };
}

// Server errors are keyed by API path ("address.postalCode"). Most match a
// form field directly; these point at the field the provider should fix.
const ERROR_FIELDS = {
  name: 'name.first',
  'name.given': 'name.first',
  address: 'address.street',
  'address.line': 'address.street',
};

const today = () => new Date().toISOString().slice(0, 10);

// These fields describe a patient, not the person typing. Stop the browser and
// password managers (1Password, LastPass) from offering to fill in the
// provider's own name or address.
const NO_AUTOFILL = { autoComplete: 'off', 'data-1p-ignore': true, 'data-lpignore': 'true' };

// `patient` is the patient being edited, or null to add a new one.
// `onStale` is called when the list's copy of the patient is out of date.
export default function PatientForm({ patient, reference, onClose, onSaved, onDeleted, onStale }) {
  const isNew = patient === null;
  const isMobile = useMediaQuery('(max-width: 48em)');
  const form = useForm({ initialValues: isNew ? EMPTY_FORM : toFormValues(patient) });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Validation lives on the server (one set of rules); its messages are shown
  // under the matching fields.
  async function handleSubmit(values) {
    setSubmitting(true);
    setFormError('');
    try {
      const saved = isNew
        ? await api('POST', '/patients', { body: toPayload(values) })
        : await api('PUT', `/patients/${patient.id}`, {
            body: toPayload(values),
            // Refused if someone saved this patient after we loaded it.
            headers: { 'If-Match': `"${patient.updatedAt}"` },
          });
      onSaved(saved, isNew);
    } catch (err) {
      if (err.status === 400 && err.body?.errors) {
        const fieldErrors = Object.entries(err.body.errors).map(([path, message]) => [ERROR_FIELDS[path] ?? path, message]);
        form.setErrors(Object.fromEntries(fieldErrors));
      } else if (err.status !== 401) {
        // Reload the list behind the form, so reopening shows the latest copy.
        if (err.status === 404 || err.status === 412) onStale();
        setFormError(
          {
            404: 'This patient no longer exists.',
            412: 'Someone else changed this patient while you were editing. Close the form and open the patient again to see their changes.',
          }[err.status] ?? 'Something went wrong. Please try again.'
        );
      }
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      await api('DELETE', `/patients/${patient.id}`);
      onDeleted(patient);
    } catch (err) {
      if (err.status !== 401) setFormError('Something went wrong. Please try again.');
      setSubmitting(false);
      setConfirmingDelete(false);
    }
  }

  const field = (path) => ({ ...form.getInputProps(path), ...NO_AUTOFILL });
  const selectedStatus = reference.statuses.find((s) => s.code === form.values.status);

  return (
    <Modal
      opened
      onClose={onClose}
      title={<Text fw={600} size="lg">{isNew ? 'Add patient' : 'Edit patient'}</Text>}
      size="lg"
      fullScreen={isMobile}
      closeOnClickOutside={false} // a stray click shouldn't throw away typing
    >
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack gap="lg">
          {formError && (
            <Alert color="red" variant="light">
              {formError}
            </Alert>
          )}

          <Fieldset legend="Name" variant="unstyled">
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="First (given) name" withAsterisk data-autofocus {...field('name.first')} />
              <TextInput label="Middle name(s)" {...field('name.middle')} />
              <TextInput
                label="Last (family) name"
                description="Leave blank if the patient has only one name."
                {...field('name.family')}
              />
              <TextInput label="Suffix" placeholder="Jr., III" {...field('name.suffix')} />
              <TextInput label="Prefix" placeholder="Dr., Mx." {...field('name.prefix')} />
              <TextInput
                label="Preferred name"
                description="What the patient likes to be called."
                {...field('preferredName')}
              />
            </SimpleGrid>
          </Fieldset>

          <Fieldset legend="Details" variant="unstyled">
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Date of birth" type="date" max={today()} withAsterisk {...field('birthDate')} />
              <Select
                label="Status"
                withAsterisk
                allowDeselect={false}
                data={reference.statuses.map((s) => ({ value: s.code, label: s.label }))}
                description={selectedStatus?.description}
                renderOption={({ option }) => (
                  <div>
                    <Text size="sm">{option.label}</Text>
                    <Text size="xs" c="dimmed">
                      {reference.statuses.find((s) => s.code === option.value)?.description}
                    </Text>
                  </div>
                )}
                {...field('status')}
              />
            </SimpleGrid>
          </Fieldset>

          <Fieldset legend="Address" variant="unstyled">
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Street" withAsterisk {...field('address.street')} />
              <TextInput label="Apt / unit" {...field('address.unit')} />
              <TextInput label="City" withAsterisk {...field('address.city')} />
              <SimpleGrid cols={2}>
                <Select
                  label="State"
                  withAsterisk
                  searchable
                  nothingFoundMessage="No matching state"
                  data={reference.states.map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` }))}
                  {...field('address.state')}
                />
                <TextInput label="ZIP" withAsterisk inputMode="numeric" {...field('address.postalCode')} />
              </SimpleGrid>
            </SimpleGrid>
          </Fieldset>

          {confirmingDelete ? (
            <Alert color="red" variant="light" title="Delete this patient?">
              <Stack gap="sm">
                <Text size="sm">
                  Use this only for records created by mistake. The record is kept for auditing but hidden from the
                  list. If care has ended, set the status to Finished instead.
                </Text>
                <Group justify="flex-end">
                  <Button variant="default" onClick={() => setConfirmingDelete(false)} disabled={submitting}>
                    Keep patient
                  </Button>
                  <Button color="red" onClick={handleDelete} loading={submitting}>
                    Delete patient
                  </Button>
                </Group>
              </Stack>
            </Alert>
          ) : (
            <Group justify="space-between">
              {isNew ? (
                <span />
              ) : (
                <Button variant="subtle" color="red" onClick={() => setConfirmingDelete(true)} disabled={submitting}>
                  Delete
                </Button>
              )}
              <Group>
                <Button variant="default" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" loading={submitting}>
                  {isNew ? 'Add patient' : 'Save changes'}
                </Button>
              </Group>
            </Group>
          )}
        </Stack>
      </form>
    </Modal>
  );
}
