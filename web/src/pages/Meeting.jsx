import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, LANG, MOCK } from '../api.js';
import { analyserFor, audioContext, fakeVoice, glowFollow, glowStop, loudness } from '../audio.js';
import { Dots, MicIcon, SpeakerIcon, StopIcon } from '../components/icons.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

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
const PURPLE = '#7c5cff73', TEAL = '#14b8a673'; // purple = a person talking, teal = ParentBridge talking
const mimeType = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/mp4';

// One turn: idle → recording → translating → playing → idle.
// phase = { name, speaker } while recording/translating, plus listener while playing.
export default function Meeting() {
  const navigate = useNavigate();
  const [transcript, setTranscript] = useState([]);
  const [phase, setPhase] = useState({ name: 'idle' });
  const [error, setError] = useState(null); // { lang, text } shown in that side's status line
  const [blocked, setBlocked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [glowColor, setGlowColor] = useState({ fr: PURPLE, en: PURPLE }); // kept after a turn so the fade-out keeps its colour
  const [band, setBand] = useState(null); // handoff band geometry + direction
  const [scrolled, setScrolled] = useState(false);

  const stream = useRef(null), micAnalyser = useRef(null), recorder = useRef(null);
  const startedAt = useRef(0), skipPlayback = useRef(null), history = useRef([]);
  const bloom = { fr: useRef(null), en: useRef(null) };
  const micButton = { parent: useRef(null), teacher: useRef(null) };
  const captionsEnd = useRef(null);

  // Ask for the mic when the meeting opens; release it when leaving the page.
  useEffect(() => {
    let left = false;
    (navigator.mediaDevices ? navigator.mediaDevices.getUserMedia({ audio: true }) : Promise.reject())
      .then(s => (left ? s.getTracks().forEach(t => t.stop()) : (stream.current = s)))
      .catch(() => { if (!MOCK) setBlocked(true); }); // denied, or plain HTTP (no mediaDevices at all)
    return () => {
      left = true;
      skipPlayback.current?.();
      glowStop();
      stream.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => { captionsEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [transcript.length]);

  function lightUp(lang, color, reader) {
    setGlowColor(c => ({ ...c, [lang]: color }));
    glowFollow(bloom[lang].current, reader);
  }

  // --- Recording (tap to start, tap again to stop) ---

  function start(speaker) {
    const lang = LANG[speaker];
    if (!stream.current && !MOCK) return setError({ lang, text: lang === 'fr' ? 'Micro non disponible' : 'Microphone not available' });
    setError(null);
    const ctx = audioContext(); // inside the tap, so the browser allows audio
    if (stream.current && !micAnalyser.current) micAnalyser.current = analyserFor(ctx.createMediaStreamSource(stream.current));
    startedAt.current = performance.now();
    setPhase({ name: 'recording', speaker });
    lightUp(lang, PURPLE, micAnalyser.current ? () => loudness(micAnalyser.current) : fakeVoice);
    if (stream.current) {
      const chunks = [];
      const rec = new MediaRecorder(stream.current, { mimeType });
      rec.ondataavailable = e => chunks.push(e.data);
      rec.start();
      recorder.current = { rec, chunks };
    }
  }

  function stop(speaker) {
    glowStop();
    const r = recorder.current;
    recorder.current = null;
    if (performance.now() - startedAt.current < 500) { // ignore accidental taps
      r?.rec.stop();
      return setPhase({ name: 'idle' });
    }
    startHandoff(speaker);
    if (!r) return sendTurn(null, speaker); // mock without a mic
    r.rec.onstop = () => sendTurn(new Blob(r.chunks, { type: mimeType }), speaker);
    r.rec.stop();
  }

  // The handoff band (Figma "Glow J") runs from the speaker's mic to the listener's mic.
  // Measured from the real buttons, so it lines up whatever the layout.
  function startHandoff(speaker) {
    setPhase({ name: 'translating', speaker });
    const a = micButton[speaker].current.getBoundingClientRect();
    const b = micButton[OTHER[speaker]].current.getBoundingClientRect();
    const ax = a.left + a.width / 2, bx = b.left + b.width / 2;
    setBand({ toFr: speaker === 'teacher', style: { left: Math.min(ax, bx), width: Math.abs(bx - ax), top: a.top + a.height / 2 - 45 } });
  }

  // --- Turn: send audio, show captions, play the translation ---

  async function sendTurn(blob, speaker) {
    const lang = LANG[speaker];
    try {
      const { audio_b64, ...turn } = await api.turn(blob, speaker, history.current.slice(-6));
      history.current = [...history.current, turn];
      setTranscript(history.current); // caption first, then audio
      await play(turn, audio_b64);    // mics stay locked until the voice finishes (or is skipped)
    } catch (e) {
      setError({ lang, text: e.message === 'No speech detected' ? STATUS.noSpeech[lang] : e.message });
    } finally {
      glowStop();
      setPhase({ name: 'idle' });
    }
  }

  // Playback (Figma "Glow D"): the listener's side glows teal; their button becomes a speaker (tap = skip).
  function play(turn, audio_b64) {
    const listener = OTHER[turn.speaker];
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; skipPlayback.current = null; resolve(); } };
      // The band reaches the listener on the same frame the voice starts (not after a fixed delay).
      const started = reader => { setPhase({ name: 'playing', speaker: turn.speaker, listener }); lightUp(LANG[listener], TEAL, reader); };

      if (audio_b64) {
        const audio = new Audio('data:audio/mpeg;base64,' + audio_b64);
        const ctx = audioContext();
        const analyser = analyserFor(ctx.createMediaElementSource(audio));
        analyser.connect(ctx.destination); // the analyser sits between the audio and the speakers
        audio.onplaying = () => started(() => loudness(analyser) * 0.4); // TTS is mastered much louder than a mic
        audio.onended = audio.onerror = finish;
        skipPlayback.current = () => { audio.pause(); finish(); };
        audio.play().catch(finish);
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

  const handoffStage = phase.name === 'translating' ? ' travel' : phase.name === 'playing' ? ' arrive' : '';

  return (
    <>
      {blocked && (
        <div className="banner" role="alert">
          <span lang="fr">Micro bloqué : autorisez l'accès au micro dans les réglages du navigateur, puis rechargez la page.</span><br />
          Microphone blocked: allow mic access in your browser settings, then reload the page.
        </div>
      )}
      <main className={`meeting${phase.name === 'translating' ? ' translating' : ''}`}>
        {['fr', 'en'].map(lang => (
          <div key={lang} className={`panel ${lang}${speakingLang === lang ? ' speaking' : ''}${playingLang === lang ? ' playing' : ''}`}>
            <div className="bloom"><i ref={bloom[lang]} style={{ '--glow': glowColor[lang] }} /></div>
          </div>
        ))}
        <h2 className="fr" lang="fr">Français</h2>
        <h2 className="en">English</h2>

        <div className={`captions${scrolled ? ' scrolled' : ''}`} onScroll={e => setScrolled(e.currentTarget.scrollTop > 0)}>
          {transcript.length === 0 && (
            <>
              <p className="hint" lang="fr">{blocked ? 'Micro non disponible' : 'Touchez le micro pour parler'}<small>Rencontre parents-enseignant · Léo Martin, 4e année</small></p>
              <p className="hint" lang="en">{blocked ? 'Microphone unavailable' : 'Tap the mic to speak'}<small>Parent–teacher conference · Léo Martin, Grade 4</small></p>
            </>
          )}
          {transcript.map((turn, i) => ['fr', 'en'].map(lang => { // one row per turn: FR cell, EN cell
            const own = lang === turn.source_lang;
            return (
              <div key={`${i}-${lang}`} lang={lang} className={`cap ${own ? 'own' : 'other'}${i === transcript.length - 1 ? ' latest' : ''}`}>
                <span className="label">{ROLE[lang][turn.speaker]}{own ? '' : ' · ' + ROLE[lang].translated}</span>
                <p>{own ? turn.source_text : turn.target_text}</p>
              </div>
            );
          }))}
          <div ref={captionsEnd} className="captions-end" />
        </div>

        {micFor('parent')}
        {micFor('teacher')}

        <div className="end-row">
          <button className="btn end" disabled={phase.name !== 'idle' || transcript.length === 0} onClick={() => setConfirming(true)}>
            Terminer · End
          </button>
        </div>
      </main>

      {band && <div className={`handoff${band.toFr ? ' to-fr' : ''}${handoffStage}`} style={band.style} />}
      <ConfirmDialog open={confirming} onClose={result => {
        setConfirming(false);
        if (result === 'end') navigate('/summary', { state: { transcript: history.current } });
      }} />
    </>
  );
}
