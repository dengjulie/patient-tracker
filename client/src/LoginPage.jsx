import { useState } from 'react';
import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { api } from './api.js';

export default function LoginPage({ notice, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      onLogin(await api('POST', '/session', { body: { email, password } }));
    } catch (err) {
      // The server's message is written for providers ("Email or password is incorrect").
      setError(err.status === 401 || err.status === 400 ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <Center mih="100vh" bg="gray.0" px="md">
      <Paper withBorder shadow="sm" radius="md" p="xl" w="100%" maw={380}>
        <form onSubmit={handleSubmit}>
          <Stack>
            <div>
              <Title order={2}>Patient Tracker</Title>
              <Text c="dimmed" size="sm">
                Log in with your provider account.
              </Text>
            </div>

            {notice && (
              <Alert color="blue" variant="light">
                {notice}
              </Alert>
            )}

            <TextInput
              label="Email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={error}
            />
            <Button type="submit" loading={submitting} fullWidth>
              Log in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
