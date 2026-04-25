import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App';

// Vite envs are exposed via import.meta.env. envPrefix in vite.config.js
// also accepts REACT_APP_ during the CRA-to-Vite transition window so a
// dev or Vercel project that has not renamed env vars yet keeps working.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || import.meta.env.REACT_APP_SENTRY_DSN;
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
