import { Group, Text, Title } from '@mantine/core';

// The title and one-line description above a patient list (search results,
// a status worklist, recent patients), so every list says what it shows and
// in what order, in the same space, and the table doesn't move between them.
// `action` is an optional button on the right (e.g. Hide).
export default function ListHeader({ title, description, action }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <div>
        <Title order={2} size="h4">
          {title}
        </Title>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </div>
      {action}
    </Group>
  );
}
