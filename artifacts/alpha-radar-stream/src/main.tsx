import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register(
    `${import.meta.env.BASE_URL.replace(/\/$/, '')}/sw.js`,
    { scope: import.meta.env.BASE_URL },
  ).catch(() => {
    // In-app alerts remain fully usable when a browser refuses service workers.
  });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
