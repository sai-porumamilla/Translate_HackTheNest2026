import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, dateFormat } from '../api.js';
import { useAuth } from '../auth.jsx';
import SummaryView from '../components/SummaryView.jsx';

// A saved meeting, read-only. Opened from a dashboard card (which passes the meeting along),
// or by URL, in which case it is looked up in the meeting list.
export default function PastMeeting() {
  const { id } = useParams();
  const { state } = useLocation();
  const { setTeacher } = useAuth();
  const [meeting, setMeeting] = useState(state?.meeting ?? null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (meeting) return;
    api.meetings().then(
      list => {
        const found = list.find(m => String(m.id) === id);
        if (found) setMeeting(found);
        else setError('Rencontre introuvable · Meeting not found');
      },
      e => (e.status === 401 ? setTeacher(null) : setError(e.message)),
    );
  }, [id, meeting, setTeacher]);

  const title = meeting
    ? `${meeting.student} · ${dateFormat.format(new Date(meeting.created_at))}`
    : error || 'Chargement… · Loading…';
  const actions = <Link className="btn" to="/dashboard">← <span lang="fr">Tableau de bord</span> · Dashboard</Link>;
  return <SummaryView title={title} summary={meeting} actions={actions} />;
}
