import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, LANG, MOCK } from '../api.js';
import { analyserFor, audioContext, envelopeOf, fakeVoice, glowFollow, glowStop, loudness, player, unlockPlayer } from '../audio.js';
import { Dots, MicIcon, SpeakerIcon, StopIcon } from '../components/icons.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useAuth } from '../auth.jsx';
import { Bi, say, useLang } from '../lang.jsx';

const OTHER = { parent: 'teacher', teacher: 'parent' };
const ROLE = {
  fr: { parent: 'Parent', teacher: 'Enseignant', translated: 'traduction' },
  en: { parent: 'Parent', teacher: 'Teacher', translated: 'translation' },
};
const STATUS = {
  listening: { fr: 'Écoute en cours… touchez pour arrêter', en: 'Listening… tap to stop' },
  translating: { fr: 'Traduction…', en: 'Translating…' },
  playing: { fr: 'Lecture de la traduction… touchez pour passer', en: 'Playing translation… tap to skip' },
  noSpeech: { fr: 'Aucune parole détectée · Réessayez', en: 'No speech detected · Try again' },
};
// Glow colours come from the theme tokens in styles.css: --voice = a person talking, --interp = ParentBridge talking
const PURPLE = 'var(--glow-voice)', TEAL = 'var(--glow-interp)';
// Portrait phones and tablets: face-to-face layout (device lies flat between parent and teacher).
const FACE_TO_FACE = '(orientation: portrait) and (max-width: 1024px)';

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const update = () => setMatches(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}
const mimeType = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/mp4';

// One turn: idle → recording → translating → playing → idle.
// phase = { name, speaker } while recording/translating, plus listener while playing.
export default function Meeting() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const lang = useLang();
  const [transcript, setTranscript] = useState([]);
  const [phase, setPhase] = useState({ name: 'idle' });
  const [error, setError] = useState(null); // { lang, text } shown in that side's status line
  const [blocked, setBlocked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [glowColor, setGlowColor] = useState({ fr: PURPLE, en: PURPLE }); // kept after a turn so the fade-out keeps its colour
  const [orb, setOrb] = useState(null); // handoff light: { key, x, y, dx, dy, stage: start → travel → arrive | gone }
  const [scrolled, setScrolled] = useState(false);
  const faceToFace = useMediaQuery(FACE_TO_FACE);

  const recorder = useRef(null); // { rec, chunks, stream } while someone is talking
  const startedAt = useRef(0), skipPlayback = useRef(null), history = useRef([]);
  const lastTurn = useRef(null); // { turn, audio_b64 }: what Repeat plays again
  const bloom = { fr: useRef(null), en: useRef(null) };
  const micButton = { parent: useRef(null), teacher: useRef(null) };

  // Ask for mic permission when the meeting opens, then let go of the mic straight away.
  // The mic is only open while someone is talking: while a page records, iOS plays sound through the
  // quiet earpiece, which made the translation inaudible on iPhone.
  useEffect(() => {
    (navigator.mediaDevices ? navigator.mediaDevices.getUserMedia({ audio: true }) : Promise.reject())
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => { if (!MOCK) setBlocked(true); }); // denied, or plain HTTP (no mediaDevices at all)
    return () => {
      skipPlayback.current?.();
      glowStop();
      recorder.current?.stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Keep the newest turn in view (one caption list on desktop, one per half face-to-face)
  useEffect(() => {
    document.querySelectorAll('.captions').forEach(el => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  }, [transcript.length, faceToFace]);

  // Handoff stages. 'start' renders the orb at the speaker's mic; two frames later 'travel' sets its target,
  // so the CSS transition has a starting point. 'arrive' / 'gone' remove it once their transition is done.
  useEffect(() => {
    if (orb?.stage === 'start') {
      let second;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setOrb(o => (o?.stage === 'start' ? { ...o, stage: 'travel' } : o)));
      });
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }
    if (orb?.stage === 'arrive' || orb?.stage === 'gone') {
      const timer = setTimeout(() => setOrb(null), orb.stage === 'arrive' ? 450 : 220);
      return () => clearTimeout(timer);
    }
  }, [orb?.stage]);

  function lightUp(lang, color, reader) {
    setGlowColor(c => ({ ...c, [lang]: color }));
    glowFollow(bloom[lang].current, reader);
  }

  // --- Recording (tap to start, tap again to stop) ---

  function start(speaker) {
    const lang = LANG[speaker];
    setError(null);
    const ctx = audioContext(); // both inside the tap, so iOS allows audio for the rest of the meeting
    unlockPlayer();
    startedAt.current = performance.now();
    setPhase({ name: 'recording', speaker });
    lightUp(lang, PURPLE, fakeVoice); // switches to the real mic level as soon as the mic is open
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      if (recorder.current !== 'pending' + speaker) return stream.getTracks().forEach(t => t.stop()); // already stopped
      const analyser = analyserFor(ctx.createMediaStreamSource(stream));
      glowFollow(bloom[lang].current, () => loudness(analyser));
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType });
      rec.ondataavailable = e => chunks.push(e.data);
      rec.start();
      recorder.current = { rec, chunks, stream };
    }, () => {
      if (MOCK) return; // mock mode works without a mic
      recorder.current = null;
      setPhase({ name: 'idle' });
      glowStop();
      setError({ lang, text: lang === 'fr' ? 'Micro non disponible' : 'Microphone not available' });
    });
    recorder.current = 'pending' + speaker; // mic is opening
  }

  function stop(speaker) {
    glowStop();
    const r = typeof recorder.current === 'object' ? recorder.current : null; // null = mic never opened (mock)
    recorder.current = null;
    const release = () => r?.stream.getTracks().forEach(t => t.stop()); // close the mic: iOS goes back to the loudspeaker
    if (performance.now() - startedAt.current < 500 || (!r && !MOCK)) { // accidental tap, or the mic never opened
      if (r) { r.rec.onstop = release; r.rec.stop(); }
      return setPhase({ name: 'idle' });
    }
    startHandoff(speaker);
    if (!r) return sendTurn(null, speaker); // mock without a mic
    r.rec.onstop = () => { release(); sendTurn(new Blob(r.chunks, { type: mimeType }), speaker); };
    r.rec.stop();
  }

  // Handoff (Figma "Glow J"): one light leaves the speaker's mic and travels to the listener's mic,
  // turning from purple to teal. Positions are measured from the real buttons, so any layout lines up.
  function startHandoff(speaker) {
    setPhase({ name: 'translating', speaker });
    const a = micButton[speaker].current.getBoundingClientRect();
    const b = micButton[OTHER[speaker]].current.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    // dx for side-by-side, dy for face-to-face: the same light travels whichever way the mics are laid out
    setOrb({ key: Date.now(), x: ax, y: ay, dx: b.left + b.width / 2 - ax, dy: b.top + b.height / 2 - ay, stage: 'start' });
  }

  // --- Turn: send audio, show captions, play the translation ---

  async function sendTurn(blob, speaker) {
    const lang = LANG[speaker];
    try {
      const { audio_b64, ...turn } = await api.turn(blob, speaker, history.current.slice(-6));
      history.current = [...history.current, turn];
      setTranscript(history.current); // caption first, then audio
      lastTurn.current = { turn, audio_b64 };
      await play(turn, audio_b64);    // mics stay locked until the voice finishes (or is skipped)
    } catch (e) {
      setError({ lang, text: e.message === 'No speech detected' ? STATUS.noSpeech[lang] : e.message });
    } finally {
      glowStop();
      setPhase({ name: 'idle' });
      setOrb(o => (o && o.stage !== 'arrive' ? { ...o, stage: 'gone' } : o)); // error / no playback: fade out in place
    }
  }

  // Playback (Figma "Glow D"): the listener's side glows teal; their button becomes a speaker (tap = skip).
  function play(turn, audio_b64) {
    const listener = OTHER[turn.speaker];
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; skipPlayback.current = null; resolve(); } };
      // The light lands on the same frame the voice starts (not after a fixed delay): the orb finishes its trip
      // and fades while the listener's glow fades in, so the two merge into one light.
      const started = reader => {
        setPhase({ name: 'playing', speaker: turn.speaker, listener });
        setOrb(o => o && { ...o, stage: 'arrive' });
        lightUp(LANG[listener], TEAL, reader);
      };

      if (audio_b64) {
        // The shared <audio> player (unlocked in the mic tap) plays the ElevenLabs mp3 directly, not through Web Audio.
        // The glow follows the mp3's loudness curve at the current playback time.
        let envelope = null;
        envelopeOf(audio_b64).then(e => { envelope = e; }, () => {});
        player.onplaying = () => started(() => (envelope?.[Math.floor(player.currentTime * 50)] ?? 0.05) * 0.4);
        player.onended = player.onerror = finish;
        skipPlayback.current = () => { player.pause(); finish(); };
        player.src = 'data:audio/mpeg;base64,' + audio_b64;
        player.play().catch(finish);
      } else if (window.speechSynthesis) {
        // TEMP: browser voice for mock mode (no audio_b64). Real turns always use the ElevenLabs mp3 above.
        const u = new SpeechSynthesisUtterance(turn.target_text);
        u.lang = turn.target_lang === 'fr' ? 'fr-FR' : 'en-US';
        let begun = false;
        u.onstart = () => { begun = true; started(fakeVoice); };
        u.onend = u.onerror = finish;
        skipPlayback.current = () => { speechSynthesis.cancel(); finish(); };
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
        setTimeout(() => { if (!begun) finish(); }, 2000); // some browsers never start (no voices installed)
      } else finish();
    });
  }

  // Repeat: the listener asks to hear the last translation again (same voice, same glow; nothing is re-translated).
  async function repeat() {
    if (phase.name !== 'idle' || !lastTurn.current) return;
    setError(null);
    try { await play(lastTurn.current.turn, lastTurn.current.audio_b64); } finally { glowStop(); setPhase({ name: 'idle' }); }
  }

  // Back to the dashboard. The transcript only lives on this page, so leaving mid-meeting skips the summary.
  function leave() {
    if (transcript.length && !confirm(say(lang, 'Quitter sans enregistrer de résumé ?', 'Leave without saving a summary?'))) return;
    navigate(user ? '/dashboard' : '/login');
  }

  function onMic(speaker) {
    if (phase.name === 'playing' && phase.listener === speaker) skipPlayback.current?.();
    else if (phase.name === 'recording' && phase.speaker === speaker) stop(speaker);
    else if (phase.name === 'idle') start(speaker);
  }

  // --- What each side shows ---

  const speakingLang = phase.name === 'recording' ? LANG[phase.speaker] : null;
  const playingLang = phase.name === 'playing' ? LANG[phase.listener] : null;

  function status(lang) {
    if (error?.lang === lang) return { text: error.text, isError: true };
    if (speakingLang === lang) return { text: STATUS.listening[lang] };
    if (phase.name === 'translating') return { text: STATUS.translating[lang] };
    if (playingLang === lang) return { text: STATUS.playing[lang] };
    return { text: '' };
  }

  function micFor(speaker) {
    const lang = LANG[speaker];
    const recording = speakingLang === lang;
    const loading = phase.name === 'translating' && phase.speaker === speaker;
    const playing = playingLang === lang;
    const disabled = blocked || phase.name === 'translating'
      || (phase.name === 'recording' && !recording) || (phase.name === 'playing' && !playing);
    const s = status(lang);
    return (
      <div key={speaker} className={`controls ${lang}`} lang={lang}>
        <div className={`status${s.isError ? ' error' : ''}`}>{s.text}</div>
        <button ref={micButton[speaker]} className={`mic${loading ? ' loading' : ''}${playing ? ' playing' : ''}`}
                aria-pressed={recording} aria-busy={loading} disabled={disabled} onClick={() => onMic(speaker)}
                aria-label={lang === 'fr' ? 'Touchez pour parler (parent, français)' : 'Tap to speak (teacher, English)'}>
          {recording ? <StopIcon /> : loading ? <Dots /> : playing ? <SpeakerIcon /> : <MicIcon />}
        </button>
      </div>
    );
  }

  // --- Pieces shared by both layouts ---

  const translatingClass = phase.name === 'translating' ? ' translating' : '';

  const panel = lang => (
    <div key={`panel-${lang}`} className={`panel ${lang}${speakingLang === lang ? ' speaking' : ''}${playingLang === lang ? ' playing' : ''}`}>
      <div className="bloom"><i ref={bloom[lang]} style={{ '--glow': glowColor[lang] }} /></div>
    </div>
  );

  const heading = lang => <h2 key={`h-${lang}`} className={lang} lang={lang}>{lang === 'fr' ? 'Français' : 'English'}</h2>;

  const HINT = {
    fr: [blocked ? 'Micro non disponible' : 'Touchez le micro pour parler', 'Rencontre parents-enseignant · Léo Martin, 4e année'],
    en: [blocked ? 'Microphone unavailable' : 'Tap the mic to speak', 'Parent–teacher conference · Léo Martin, Grade 4'],
  };

  const captions = langs => (
    <div key={`captions-${langs.join()}`} className={`captions${langs.length === 1 ? ' single' : ''}${scrolled ? ' scrolled' : ''}`}
         onScroll={e => setScrolled(e.currentTarget.scrollTop > 0)}>
      {transcript.length === 0 && langs.map(lang => (
        <p key={lang} className="hint" lang={lang}>{HINT[lang][0]}<small>{HINT[lang][1]}</small></p>
      ))}
      {transcript.map((turn, i) => langs.map(lang => {
        const own = lang === turn.source_lang;
        return (
          <div key={`${i}-${lang}`} lang={lang} className={`cap ${own ? 'own' : 'other'}${i === transcript.length - 1 ? ' latest' : ''}`}>
            <span className="label">{ROLE[lang][turn.speaker]}{own ? '' : ' · ' + ROLE[lang].translated}</span>
            <p>{own ? turn.source_text : turn.target_text}</p>
          </div>
        );
      }))}
    </div>
  );

  const endRow = (
    <div className="end-row">
      <button className="btn" onClick={leave} disabled={phase.name === 'recording' || phase.name === 'translating'}>
        ← {user ? <Bi fr="Tableau de bord" en="Dashboard" /> : <Bi fr="Retour" en="Back" />}
      </button>
      <button className="btn" onClick={repeat} disabled={phase.name !== 'idle' || transcript.length === 0}
              aria-label={say(lang, 'Répéter la dernière traduction', 'Repeat the last translation')}>
        ↻ <Bi fr="Répéter" en="Repeat" />
      </button>
      <button className="btn end" disabled={phase.name !== 'idle' || transcript.length === 0} onClick={() => setConfirming(true)}>
        <Bi fr="Terminer" en="End" />
      </button>
    </div>
  );

  return (
    <>
      {blocked && (
        <div className="banner" role="alert">
          <span lang="fr">Micro bloqué : autorisez l'accès au micro dans les réglages du navigateur, puis rechargez la page.</span><br />
          Microphone blocked: allow mic access in your browser settings, then reload the page.
        </div>
      )}
      {faceToFace ? (
        // Face-to-face: English half on top, rotated for the teacher across the table; French half faces the parent.
        // Each half shows only its own language.
        <main className={`meeting face${translatingClass}`}>
          {['en', 'fr'].map(lang => (
            <section key={lang} className={`half ${lang}`}>
              {panel(lang)}
              {heading(lang)}
              {captions(lang === 'fr' ? ['fr'] : ['en'])}
              {micFor(lang === 'fr' ? 'parent' : 'teacher')}
            </section>
          ))}
          {endRow}
        </main>
      ) : (
        // Side by side: one shared caption grid keeps each turn's FR and EN on the same row.
        <main className={`meeting${translatingClass}`}>
          {panel('fr')}
          {panel('en')}
          {heading('fr')}
          {heading('en')}
          {captions(['fr', 'en'])}
          {micFor('parent')}
          {micFor('teacher')}
          {endRow}
        </main>
      )}

      {orb && <div key={orb.key} className={`orb ${orb.stage}`} style={{ left: orb.x, top: orb.y, '--dx': `${orb.dx}px`, '--dy': `${orb.dy}px` }} />}
      <ConfirmDialog open={confirming} onClose={result => {
        setConfirming(false);
        if (result === 'end') navigate('/summary', { state: { transcript: history.current } });
      }} />
    </>
  );
}
