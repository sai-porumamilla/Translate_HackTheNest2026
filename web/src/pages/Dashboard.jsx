import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, MOCK } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Bi, dateFor, other, say, useLang } from '../lang.jsx';

const STAGGER = [0, 40, 70, 95, 115, 130]; // ms; short and non-uniform, then the rest land together

export default function Dashboard() {
  const { user, setUser } = useAuth();
  const isTeacher = user.role === 'teacher'; // parents get a read-only list of their child's meetings
  const navigate = useNavigate();
  const lang = useLang();
  const dateFormat = dateFor(lang);
  const [meetings, setMeetings] = useState(null); // null = loading
  const [error, setError] = useState('');

  useEffect(() => {
    api.meetings().then(setMeetings, e => (e.status === 401 ? setUser(null) : setError(e.message)));
  }, [setUser]);

  async function startCall() {
    try {
      const { code } = await api.createCall();
      navigate(`/call/${code}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function signOut() {
    await api.logout().catch(() => {});
    setUser(null);
    navigate('/login');
  }

  return (
    <main className="dashboard page">
      <header className="dash-head">
        <h1><span lang={lang}>{say(lang, 'Bonjour', 'Hello')}, {user.name}</span> <span className="alt" lang={other(lang)}>{say(lang, 'Hello', 'Bonjour')}</span></h1>
        <div className="row">
          <button className="btn" onClick={signOut}><Bi fr="Déconnexion" en="Sign out" /></button>
          {isTeacher && !MOCK && <button className="btn" onClick={startCall}><Bi fr="Appel vidéo" en="Video call" /></button>}
          {isTeacher && <Link className="btn primary" to="/meeting"><Bi fr="Nouvelle rencontre" en="New meeting" /></Link>}
        </div>
      </header>
      <h2 className="eyebrow">
        {isTeacher
          ? <Bi fr="Rencontres récentes" en="Recent meetings" />
          : <Bi fr="Les rencontres de votre enfant" en="Your child's meetings" />}
      </h2>
      {error && <p className="muted"><Bi text={error} /></p>}
      {!meetings && !error && <p className="muted"><Bi fr="Chargement…" en="Loading…" /></p>}
      {meetings?.length === 0 && <p className="muted"><Bi fr="Aucune rencontre pour l’instant" en="No meetings yet" /></p>}
      <ul className="meetings">
        {meetings?.map((m, i) => (
          <li key={m.id}>
            <Link className="meeting-card" to={`/meetings/${m.id}`} state={{ meeting: m }}
                  style={{ animationDelay: `${STAGGER[Math.min(i, STAGGER.length - 1)]}ms` }}>
              <strong>{m.student}</strong>
              <time dateTime={m.created_at}>{dateFormat.format(new Date(m.created_at))}</time>
              <p lang={lang}>{say(lang, m.summary_fr, m.summary_en)}</p>
              <span className="count">{m.action_items.length} {m.action_items.length === 1 ? 'action' : 'actions'}</span>
              {m.followup && (isTeacher
                ? <span className="tag sent">{say(lang, 'Suivi envoyé', 'Follow-up sent')}</span>
                : <span className="tag new">{say(lang, 'Nouveau message', 'New message')}</span>)}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
