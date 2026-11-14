import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UpdatePrompt } from './UpdatePrompt';
import { detectLanguage, initI18n } from './i18n';
import { applyTheme, initialTheme, storedLanguage } from './preferences';
import './styles.css';

// Le thème est posé avant le premier rendu de React. (Un éclair clair reste possible pendant le
// téléchargement du script ; un script en ligne dans index.html le supprimera avec la tranche PWA.)
applyTheme(initialTheme(window.matchMedia('(prefers-color-scheme: dark)').matches), false);
await initI18n(storedLanguage() ?? detectLanguage(navigator.languages));
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <UpdatePrompt />
    <App />
  </StrictMode>,
);
