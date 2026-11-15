import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// Palette preview while choosing colours: ?theme=a|b|c (see styles.css). No param = current colours.
const theme = new URLSearchParams(location.search).get('theme');
if (theme) document.documentElement.dataset.theme = theme;

// HashRouter (#/dashboard) so FastAPI can keep serving plain static files: no server-side route fallback needed.
// No <StrictMode>: it runs effects twice in dev, which would ask for the mic twice and double-save meetings.
createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>,
);
