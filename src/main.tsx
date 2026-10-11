import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, getInitialTheme } from './domain/theme';
import { registerServiceWorker } from './pwa/registerServiceWorker';
import { completeGoogleSignInRedirect } from './storage/googleSheetsAuth';
import './styles.css';

applyTheme(getInitialTheme());

// A broker sign-in lands back here with a code in the URL; redeem it first so
// the app boots already signed in. Anywhere else this settles immediately.
void completeGoogleSignInRedirect()
  .catch(() => undefined)
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });

registerServiceWorker();
