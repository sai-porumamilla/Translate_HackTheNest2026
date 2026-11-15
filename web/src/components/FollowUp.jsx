import { useEffect, useRef, useState } from 'react';
import { api, MOCK } from '../api.js';
import { audioContext, envelopeOf, glowFollow, glowStop, player, unlockPlayer } from '../audio.js';
import { useAuth } from '../auth.jsx';
import { Bi, other, say, useLang } from '../lang.jsx';
import { Dots, SpeakerIcon, StopIcon } from './icons.jsx';

// Follow-up agent (Figma "Follow-up agent + viewer language").
// Teacher: run the agent → watch its steps arrive (real tool calls, streamed) → review → send.
// Parent: the sent message, readable in French and playable as ElevenLabs French voice.
export default function FollowUp({ meeting, onSent }) {
  const { user } = useAuth();
  return user?.role === 'teacher' ? <TeacherPanel meeting={meeting} onSent={onSent} /> : <ParentMessage meeting={meeting} />;
}

function TeacherPanel({ meeting, onSent }) {
  const lang = useLang(), alt = other(lang);
  const [state, setState] = useState(meeting.followup ? 'sent' : 'idle'); // idle | running | result | sending | sent
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function run() {
    setState('running'); setSteps([]); setResult(null); setError('');
    try {
      setResult(await api.agent(meeting.id, step => setSteps(s => [...s, step])));
      setState('result');
    } catch (e) {
      setError(e.message);
      setState('idle');
    }
  }

  async function send() {
    setState('sending');
    try {
      onSent(await api.sendFollowup(meeting.id, { message_en: result.message_en, message_fr: result.message_fr }));
      setState('sent');
    } catch (e) {
      setError(e.message);
      setState('result');
    }
  }

  const sent = meeting.followup;
  return (
    <section className={`agent ${state}`} aria-busy={state === 'running'}>
      <header>
        <h2><Bi fr="Suivi" en="Follow-up" /></h2>
        <p className="agent-by">{say(lang, 'Agent ParentBridge', 'ParentBridge agent')}{steps.length > 0 && ` · ${steps.length} ${say(lang, 'étapes', 'steps')}`}</p>
      </header>

      {state === 'idle' && (
        <p className="agent-intro">{say(lang,
          'Un agent relit les rencontres passées, vérifie ce qui reste à faire et rédige un message au parent, en français.',
          'An agent reads the past meetings, checks what is still open, and drafts a message to the parent in French.')}</p>
      )}

      {steps.length > 0 && (
        <ol className="steps" aria-live="polite">
          {steps.map((s, i) => <li key={i} lang={lang}>{s[lang]}</li>)}
          {state === 'running' && <li className="working" aria-hidden="true"><Dots /></li>}
        </ol>
      )}
      {state === 'running' && steps.length === 0 && <ol className="steps"><li className="working"><Dots /></li></ol>}

      {result && state !== 'sent' && (
        <div className="agent-result">
          <div className="box">
            <h3 className="eyebrow">{say(lang, 'Encore à faire', 'Still open')}</h3>
            <ul className="open-items">
              {result.open_items.map((item, i) => (
                <li key={i}>
                  <strong lang={lang}>{item[`task_${lang}`]}</strong>
                  <span className="who">{item.owner === 'Teacher' ? say(lang, 'Enseignant', 'Teacher') : 'Parent'}{item.due && ` · ${item.due}`}</span>
                  {item.status === 'overdue' && <span className="tag overdue">{say(lang, 'En retard', 'Overdue')}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="box">
            <h3 className="eyebrow">{say(lang, 'Message au parent', 'Message to the parent')}</h3>
            <p lang={lang}>{result[`message_${lang}`]}</p>
            <p className="echo" lang={alt}>{result[`message_${alt}`]}</p>
          </div>
          <div className="questions">
            <h3 className="eyebrow">{say(lang, 'Pour la prochaine rencontre', 'For the next meeting')}</h3>
            <ul>{result[`next_questions_${lang}`].map((q, i) => <li key={i} lang={lang}>{q}</li>)}</ul>
          </div>
        </div>
      )}

      {state === 'sent' && sent && (
        <div className="agent-sent">
          <p className="sent-pill">✓ <Bi fr="Envoyé" en="Sent" /></p>
          <p lang={lang}>{sent[`message_${lang}`]}</p>
        </div>
      )}

      {error && <p className="form-error" role="alert"><Bi text={error} /></p>}

      <div className="row">
        {state === 'idle' && <button className="btn interp" onClick={run}><Bi fr="Préparer le suivi" en="Prepare follow-up" /></button>}
        {(state === 'result' || state === 'sending') && (
          <button className="btn interp" onClick={send} disabled={state === 'sending'}><Bi fr="Envoyer au parent" en="Send to parent" /></button>
        )}
        {(state === 'result' || state === 'sent') && <button className="btn" onClick={run}><Bi fr="Relancer" en="Run again" /></button>}
      </div>
    </section>
  );
}

function ParentMessage({ meeting }) {
  const lang = useLang(), alt = other(lang);
  const followup = meeting.followup;
  const bloom = useRef(null);
  const [playing, setPlaying] = useState(false); // false | 'loading' | true
  const [error, setError] = useState('');

  useEffect(() => () => { player.pause(); glowStop(); }, []); // leaving the page stops the voice

  if (!followup) return null;

  async function toggle() {
    if (playing) { player.pause(); glowStop(); setPlaying(false); return; }
    audioContext(); unlockPlayer(); // inside the tap: iOS only plays sound unlocked by a gesture
    setPlaying('loading'); setError('');
    try {
      const mp3 = await api.followupAudio(meeting.id);
      const envelope = await envelopeOf(mp3).catch(() => null);
      player.onplaying = () => {
        setPlaying(true);
        glowFollow(bloom.current, () => (envelope?.[Math.floor(player.currentTime * 50)] ?? 0.05) * 0.4);
      };
      player.onended = player.onerror = () => { glowStop(); setPlaying(false); };
      player.src = URL.createObjectURL(new Blob([mp3], { type: 'audio/mpeg' }));
      await player.play();
    } catch (e) {
      setError(e.message);
      setPlaying(false);
    }
  }

  return (
    <section className={`message-card${playing === true ? ' playing' : ''}`}>
      <header>
        {!MOCK && (
          <button className="play" onClick={toggle} aria-pressed={playing === true}
                  aria-label={say(lang, playing ? 'Arrêter' : 'Écouter le message en français', playing ? 'Stop' : 'Listen in French')}>
            <span className="glow" aria-hidden="true"><i ref={bloom} /></span>
            {playing === 'loading' ? <Dots /> : playing ? <StopIcon /> : <SpeakerIcon />}
          </button>
        )}
        <div>
          <h2 lang={lang}>{say(lang, `Message de ${followup.teacher}`, `Message from ${followup.teacher}`)}</h2>
          <p className="agent-by" lang={lang}>{playing === true ? say(lang, 'Lecture en français…', 'Playing in French…') : say(lang, 'Touchez pour écouter en français', 'Tap to listen in French')}</p>
        </div>
      </header>
      <p lang={lang}>{followup[`message_${lang}`]}</p>
      <details>
        <summary lang={alt}>{say(alt, 'En français', 'In English')}</summary>
        <p className="echo" lang={alt}>{followup[`message_${alt}`]}</p>
      </details>
      {error && <p className="form-error" role="alert"><Bi text={error} /></p>}
    </section>
  );
}
