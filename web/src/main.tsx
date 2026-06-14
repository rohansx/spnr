import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './theme.css';
import App from './App';
import { AuthProvider } from './lib/useAuth';

// Apply the saved light/dark choice before first paint (avoids a flash); the
// ThemeToggle in the Shell keeps it in sync thereafter.
try {
  document.documentElement.dataset.theme =
    localStorage.getItem('spnr-theme') === 'dark' ? 'dark' : 'light';
} catch {
  /* no localStorage — default light */
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
