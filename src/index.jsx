import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App';

// Vite envs are exposed via import.meta.env. Vars must be VITE_-prefixed
// at build time to be embedded in the client bundle.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
Sentry.init({
  dsn: SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!SENTRY_DSN,
  tracesSampleRate: 0.2,
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
