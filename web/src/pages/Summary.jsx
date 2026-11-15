import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { api, STUDENT } from '../api.js';
import { useAuth } from '../auth.jsx';
import SummaryView from '../components/SummaryView.jsx';
import { Bi } from '../lang.jsx';

// Right after "End meeting": the transcript arrives in router state from /meeting.
export default function Summary() {
  const { state } = useLocation();
  const { user } = useAuth();
  const transcript = state?.transcript;
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [attempt, setAttempt] = useState(0); // bump to retry

  useEffect(() => {
    if (!transcript) return;
    let live = true;
    setError('');
    api.summary(transcript).then(async s => {
      if (!live) return;
      setSummary(s);
      if (user?.role !== 'teacher') return; // guests and parents don't save (only the teacher's meetings are stored)
      setNote({ text: <Bi fr="Enregistrement…" en="Saving…" /> });
      try {
        await api.saveMeeting({ student: STUDENT, ...s });
        if (live) setNote({ text: <Bi fr="Enregistré dans le tableau de bord" en="Saved to your dashboard" /> });
      } catch (e) {
        if (live) setNote({ text: <><Bi fr="Non enregistré" en="Not saved" />: <Bi text={e.message} /></>, isError: true });
      }
    }, e => live && setError(e.message));
    return () => { live = false; };
  }, [transcript, user, attempt]);

  if (!transcript) return <Navigate to="/meeting" replace />; // opened directly or after a refresh

  const actions = (
    <>
      {error && <button className="btn" onClick={() => setAttempt(a => a + 1)}><Bi fr="Réessayer" en="Retry" /></button>}
      {user && <Link className="btn" to="/dashboard">← <Bi fr="Tableau de bord" en="Dashboard" /></Link>}
      <Link className={`btn primary${summary ? '' : ' disabled'}`} to="/meeting" aria-disabled={!summary}>
        <Bi fr="Nouvelle rencontre" en="New meeting" />
      </Link>
    </>
  );
  const title = error ? <Bi fr="Résumé impossible" en="Summary failed" />
    : summary ? <Bi fr="Résumé" en="Summary" /> : <Bi fr="Préparation du résumé…" en="Preparing summary…" />;
  return <SummaryView title={title} note={error ? { text: <Bi text={error} />, isError: true } : note} summary={summary} actions={actions} />;
}
