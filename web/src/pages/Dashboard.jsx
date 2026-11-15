import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, dateFormat } from '../api.js';
import { useAuth } from '../auth.jsx';

const STAGGER = [0, 40, 70, 95, 115, 130]; // ms; short and non-uniform, then the rest land together

export default function Dashboard() {
  const { teacher, setTeacher } = useAuth();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState(null); // null = loading
  const [error, setError] = useState('');

  useEffect(() => {
    api.meetings().then(setMeetings, e => (e.status === 401 ? setTeacher(null) : setError(e.message)));
  }, [setTeacher]);

  async function signOut() {
    await api.logout().catch(() => {});
    setTeacher(null);
    navigate('/login');
  }

  return (
    <main className="dashboard page">
      <header className="dash-head">
        <h1>Bonjour · Hello, {teacher.name}</h1>
        <div className="row">
          <button className="btn" onClick={signOut}><span lang="fr">Déconnexion</span> · Sign out</button>
          <Link className="btn primary" to="/meeting"><span lang="fr">Nouvelle rencontre</span> · New meeting</Link>
        </div>
      </header>
      <h2 className="eyebrow"><span lang="fr">Rencontres récentes</span> · Recent meetings</h2>
      {error && <p className="muted">{error}</p>}
      {!meetings && !error && <p className="muted">Chargement… · Loading…</p>}
      {meetings?.length === 0 && <p className="muted">Aucune rencontre pour l’instant · No meetings yet</p>}
      <ul className="meetings">
        {meetings?.map((m, i) => (
          <li key={m.id}>
            <Link className="meeting-card" to={`/meetings/${m.id}`} state={{ meeting: m }}
                  style={{ animationDelay: `${STAGGER[Math.min(i, STAGGER.length - 1)]}ms` }}>
              <strong>{m.student}</strong>
              <time dateTime={m.created_at}>{dateFormat.format(new Date(m.created_at))}</time>
              <p>{m.summary_en}</p>
              <span className="count">{m.action_items.length} {m.action_items.length === 1 ? 'action' : 'actions'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
