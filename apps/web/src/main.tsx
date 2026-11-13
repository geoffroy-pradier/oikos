import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { detectLanguage, initI18n } from './i18n';
import './styles.css';

await initI18n(detectLanguage(navigator.languages));
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
