import { useEffect, useState } from 'react';
import { Center, Loader } from '@mantine/core';
import { api, setSessionEndHandler, stopIdleTimer } from './api.js';
import LoginPage from './LoginPage.jsx';
import PatientsPage from './PatientsPage.jsx';

const SESSION_END_MESSAGES = {
  idle: 'For privacy, you were logged out after 15 minutes of inactivity.',
  expired: 'Your session has ended. Please log in again.',
};

export default function App() {
  // undefined = still checking, null = logged out, object = logged-in provider
  const [user, setUser] = useState(undefined);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    // Unmounting the patients page throws away everything on screen,
    // including any unsaved form (PRODUCT.md §7: drafts are discarded).
    setSessionEndHandler((reason) => {
      setUser(null);
      setNotice(SESSION_END_MESSAGES[reason]);
    });

    api('GET', '/session')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    await api('DELETE', '/session').catch(() => {});
    stopIdleTimer();
    setNotice('');
    setUser(null);
  }

  function login(loggedInUser) {
    setNotice('');
    setUser(loggedInUser);
  }

  if (user === undefined) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!user) return <LoginPage notice={notice} onLogin={login} />;
  return <PatientsPage user={user} onLogout={logout} />;
}
