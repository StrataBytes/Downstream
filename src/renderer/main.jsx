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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
