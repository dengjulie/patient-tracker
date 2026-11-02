import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, Drawer, MantineProvider, Modal } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import App from './App.jsx';

// index.html always reserves the scrollbar's space. By default, Drawer and
// Modal hide the scrollbar while open and pad the page to make up for it, which
// would then shift the page sideways; this keeps the scrollbar (scrolling is
// still locked).
const KEEP_SCROLLBAR = { defaultProps: { removeScrollProps: { removeScrollBar: false } } };
const theme = createTheme({
  components: { Drawer: Drawer.extend(KEEP_SCROLLBAR), Modal: Modal.extend(KEEP_SCROLLBAR) },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>
);
