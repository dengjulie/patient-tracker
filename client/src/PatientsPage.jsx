import { useEffect, useState } from 'react';
import { Alert, Button, Center, Container, Group, Loader, Pagination, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { api } from './api.js';
import { displayName } from './format.js';
import PatientDrawer from './PatientDrawer.jsx';
import PatientTable from './PatientTable.jsx';
import RecentPatients from './RecentPatients.jsx';
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
  // The side panel shows the patient being viewed, or the form when editing:
  // editing is undefined = no form, null = adding a patient, object = editing it.
  const [viewingId, setViewingId] = useState(null);
  const [editing, setEditing] = useState(undefined);
  const [importing, setImporting] = useState(false);
  // Bumped after a save or delete to reload the list, even if the query is unchanged.
  const [refreshCount, setRefreshCount] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(null);
  // Recent patients appear only when the provider asks (PRODUCT.md §6), and
  // hide again when they search or pick a status.
  const [showRecent, setShowRecent] = useState(false);
  // How many recent patients are shown, for the count under the heading;
  // null until they've loaded.
  const [recentCount, setRecentCount] = useState(null);
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

  function closePanel() {
    setEditing(undefined);
    setViewingId(null);
  }

  // The panel goes back to (or, for a new patient, on to) the patient's view.
  function handleSaved(patient, isNew) {
    setEditing(undefined);
    setViewingId(patient.id);
    notifications.show({ color: 'green', title: isNew ? 'Patient added' : 'Changes saved', message: displayName(patient) });
    reload();
  }

  function handleDeleted(patient) {
    closePanel();
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

  // The count under the heading: matches for a search, or recent patients.
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const headingCount = patients
    ? `${plural(total, 'patient')} found`
    : !askedFor && showRecent && recentCount !== null
      ? plural(recentCount, 'recent patient')
      : null;
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
            {/* Always rendered, holding a non-breaking space when there's no
                count, so the page doesn't shift down when one appears. */}
            <Text c="dimmed" size="sm">
              {headingCount ?? '\u00A0'}
            </Text>
          </div>
          <Group gap="sm">
            {/* Which practice's patients these are (PRODUCT.md §7). */}
            <Text size="sm" c="dimmed">
              {user.name} · {user.practiceName}
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

        {/* The side panel: view, edit or add. It needs the status and state
            lists for the form's dropdowns. */}
        {(viewingId !== null || editing !== undefined) && statuses.length > 0 && (
          <PatientDrawer
            patientId={viewingId}
            editing={editing}
            refreshKey={refreshCount}
            reference={reference}
            onEdit={setEditing}
            onCancelEdit={() => setEditing(undefined)}
            onClose={closePanel}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onStale={reload}
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
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              setShowRecent(false);
            }}
            autoFocus
            rightSection={loading && patients ? <Loader size="xs" /> : null}
            style={{ flexGrow: 3 }}
          />
          <Select
            label="Status"
            placeholder="All statuses"
            data={statuses.map((s) => ({ value: s.code, label: s.label }))}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setShowRecent(false);
            }}
            clearable
          />
          {/* Clears any search or status, so the list shows right away. Stays
              in place (disabled) while the list is showing, so the row
              doesn't shift. */}
          <Button
            variant="default"
            style={{ flexGrow: 0 }}
            disabled={showRecent && !askedFor}
            onClick={() => {
              setSearch('');
              setStatus(null);
              setRecentCount(null); // not the count from last time
              setShowRecent(true);
            }}
          >
            Show my recent patients
          </Button>
        </Group>

        {[referenceError, error].filter(Boolean).map((message) => (
          <Alert key={message} color="red" variant="light">
            {message}
          </Alert>
        ))}

        {!askedFor ? (
          <>
            <Paper withBorder p="xl" radius="md">
              <Text ta="center" c="dimmed">
                {search.trim()
                  ? `Keep typing: enter at least ${MIN_SEARCH_LENGTH} characters.`
                  : 'Search by name or date of birth, or choose a status, to find patients.'}
              </Text>
            </Paper>
            {showRecent && (
              <RecentPatients
                onLoaded={setRecentCount}
                refreshKey={refreshCount}
                statuses={statuses}
                onOpen={setViewingId}
                onHide={() => setShowRecent(false)}
              />
            )}
          </>
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
          patients && <PatientTable patients={patients} statuses={statuses} onOpen={setViewingId} />
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
