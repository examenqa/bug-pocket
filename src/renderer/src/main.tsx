import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');
const root = createRoot(rootElement!);
const hasPreloadBridge = !!(window as Window & { bugPocket?: unknown }).bugPocket;

root.render(
  hasPreloadBridge ? (
    <App />
  ) : (
    <div className="preload-error">
      <h1>Bug Pocket could not start</h1>
      <p>The Electron preload bridge did not load, so the desktop app cannot talk to its local database and services.</p>
      <p>Restart the app. If this is a development run, rebuild the preload output and start again.</p>
    </div>
  )
);
