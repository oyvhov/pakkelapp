import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/inter';
import './styles.css';
import { App } from './App';
import { initPointerLife } from './motion';
import { applySeason } from './lib';

initPointerLife();
applySeason();

// Nettlesaren tilbyr installering éin gong, tidleg. Vi tek vare på tilbodet til brukaren vil ha det.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as unknown as { installPrompt?: Event }).installPrompt = e;
  window.dispatchEvent(new Event('install-ready'));
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Bilete låg tidlegare i eit eige mellomlager. No følgjer dei tilgangen til gåva.
void window.caches?.delete('gaavebilete').catch(() => undefined);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
