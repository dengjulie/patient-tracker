import { Anchor, Badge, Paper, Table, Text } from '@mantine/core';
import { STATUS_COLORS, age, displayName, formatDate, formatTimestamp, formatUpdated } from './format.js';

// The patient table, for search results and recent patients. Shows only what
// providers need to pick the right patient: no street address (PRODUCT.md §6).
// The last column is a time that matches the list's order: when the record
// was updated (search results), or when the provider last viewed it (recent
// patients, `time="viewed"`).
const TIME_COLUMNS = {
  updated: { label: 'Updated', field: 'updatedAt' },
  viewed: { label: 'Viewed', field: 'viewedAt' },
};

// Fixed column widths (layout="fixed"), so columns stay put across searches,
// worklists and recent patients instead of resizing to each list's longest
// value. Long names end in "…"; other long values wrap.
const WIDTHS = { name: '30%', birthDate: '20%', status: '14%', place: '22%', time: '14%' };

export default function PatientTable({ patients, statuses, onOpen, time: timeName = 'updated' }) {
  const time = TIME_COLUMNS[timeName];
  const statusLabel = (code) => statuses.find((s) => s.code === code)?.label ?? code;

  return (
    <Paper withBorder radius="md">
      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover verticalSpacing="sm" layout="fixed">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={WIDTHS.name}>Name</Table.Th>
              <Table.Th w={WIDTHS.birthDate}>Date of birth</Table.Th>
              <Table.Th w={WIDTHS.status}>Status</Table.Th>
              <Table.Th w={WIDTHS.place}>City, State</Table.Th>
              <Table.Th w={WIDTHS.time}>{time.label}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {patients.map((patient) => (
              // The whole row opens the patient for mouse users; the name is a
              // real button so keyboard and screen-reader users can too. Its
              // click (including Enter/Space) bubbles up to the row's handler.
              <Table.Tr key={patient.id} onClick={() => onOpen(patient.id)} style={{ cursor: 'pointer' }}>
                <Table.Td>
                  {/* One line, left-aligned, cut off with "…" when too long for
                      the column; the full name shows on hover. */}
                  <Anchor
                    component="button"
                    type="button"
                    fw={500}
                    c="inherit"
                    display="block"
                    w="100%"
                    ta="left"
                    truncate="end"
                    title={displayName(patient)}
                  >
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
                  <time dateTime={patient[time.field]} title={formatTimestamp(patient[time.field])}>
                    {formatUpdated(patient[time.field])}
                  </time>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}
