import { Anchor, Badge, Paper, Table, Text } from '@mantine/core';
import { STATUS_COLORS, age, displayName, formatDate, formatTimestamp, formatUpdated } from './format.js';

// The patient table, for search results and recent patients. Shows only what
// providers need to pick the right patient: no street address (PRODUCT.md §6).
export default function PatientTable({ patients, statuses, onOpen }) {
  const statusLabel = (code) => statuses.find((s) => s.code === code)?.label ?? code;

  return (
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
              <Table.Tr key={patient.id} onClick={() => onOpen(patient.id)} style={{ cursor: 'pointer' }}>
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
  );
}
