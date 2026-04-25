import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { NotificationProvider } from './context/NotificationContext';
import { ThemeProvider } from './context/ThemeContext';

// Service worker registration is intentionally disabled for now to avoid stale-cache runtime issues.

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <NotificationProvider>
      <App />
    </NotificationProvider>
  </ThemeProvider>,
);
