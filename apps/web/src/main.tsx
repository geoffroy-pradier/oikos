import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { detectLanguage, initI18n } from './i18n';
import { applyTheme, initialTheme, storedLanguage } from './preferences';
import './styles.css';

// Le thème est posé avant le premier rendu, pour éviter un éclair de couleur.
applyTheme(initialTheme(window.matchMedia('(prefers-color-scheme: dark)').matches), false);
await initI18n(storedLanguage() ?? detectLanguage(navigator.languages));
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
