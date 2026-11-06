import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDebugLog } from './services/debugLog';
import { initLoudnessService } from './services/loudnessService';
import './styles/index.css';

// installs log capture before anything else so early output is retained.
initDebugLog();
// background loudness scanning for contextual normalization, self-gating.
// idle unless the user has contextual selected with normalization on.
initLoudnessService();
// lets styles adjust to the older chromium in downstream for legacy macos.
if (__DOWNSTREAM_LEGACY__) document.body.classList.add('legacy-macos');
// a file dropped where nothing takes it would open in place of downstream, so the window turns it away.
// a folder that takes files says so first, which leaves its drop alone.
const holdsFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragover', (e) => {
  if (!holdsFiles(e) || e.defaultPrevented) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (e) => {
  if (holdsFiles(e) && !e.defaultPrevented) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
