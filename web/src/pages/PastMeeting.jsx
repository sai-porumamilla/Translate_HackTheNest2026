import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import FollowUp from '../components/FollowUp.jsx';
import SummaryView from '../components/SummaryView.jsx';
import { Bi, dateFor, useLang } from '../lang.jsx';

// A saved meeting, read-only. Opened from a dashboard card (which passes the meeting along),
// or by URL, in which case it is looked up in the meeting list.
export default function PastMeeting() {
  const { id } = useParams();
  const { state } = useLocation();
  const { user, setUser } = useAuth();
  const [meeting, setMeeting] = useState(state?.meeting ?? null);
  const [error, setError] = useState('');
  const lang = useLang();

  useEffect(() => {
    if (meeting) return;
    api.meetings().then(
      list => {
        const found = list.find(m => String(m.id) === id);
        if (found) setMeeting(found);
        else setError('Rencontre introuvable · Meeting not found');
      },
      e => (e.status === 401 ? setUser(null) : setError(e.message)),
    );
  }, [id, meeting, setUser]);

  const title = meeting
    ? `${meeting.student} · ${dateFor(lang).format(new Date(meeting.created_at))}`
    : <Bi text={error || 'Chargement… · Loading…'} />;
  const actions = <Link className="btn" to="/dashboard">← <Bi fr="Tableau de bord" en="Dashboard" /></Link>;
  const followUp = meeting && <FollowUp meeting={meeting} onSent={followup => setMeeting({ ...meeting, followup })} />;
  return (
    // The parent's new message goes first (it's why they opened the page); the teacher's agent panel follows the summary.
    <SummaryView title={title} summary={meeting} actions={actions} top={user?.role === 'parent' && followUp}>
      {user?.role === 'teacher' && followUp}
    </SummaryView>
  );
}
