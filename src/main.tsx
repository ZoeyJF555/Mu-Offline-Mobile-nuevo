import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      window.setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    }
  },
  onNeedRefresh() {
    updateSW(true);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
