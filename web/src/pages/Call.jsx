import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, LANG } from '../api.js';
import { analyserFor, audioContext, envelopeOf, fakeVoice, glowFollow, glowStop, loudness, player, unlockPlayer } from '../audio.js';
import { useAuth } from '../auth.jsx';
import { Dots, MicIcon, SpeakerIcon, StopIcon } from '../components/icons.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { say } from '../lang.jsx';

// Video call (Figma "Video call"). Teacher on a laptop, parent on a phone, each in their own language.
// - The call carries VIDEO ONLY: you never hear the other person's raw voice, only the ElevenLabs translation.
// - Push-to-talk as in person: your device records your voice, calls /api/turn, shows your caption, and sends the
//   turn (captions + translated mp3) to the other device over a WebRTC data channel. The other device plays it.
// - The server only helps the two browsers find each other (/api/calls/{code}/signal, polled). Nothing else goes through it.

const OTHER = { parent: 'teacher', teacher: 'parent' };
const LANG_NAME = { fr: 'Français', en: 'English' };
const PURPLE = 'var(--glow-voice)', TEAL = 'var(--glow-interp)';
const mimeType = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/mp4';

// Data channel messages are JSON. Big ones (the translated mp3) are cut into chunks: Safari caps a message at 64 KB.
const CHUNK = 16000;
function sendJson(channel, message) {
  if (channel?.readyState !== 'open') return;
  const text = JSON.stringify(message);
  if (text.length <= CHUNK) return channel.send(text);
  const id = Math.random().toString(36).slice(2), n = Math.ceil(text.length / CHUNK);
  for (let i = 0; i < n; i++) channel.send(JSON.stringify({ t: 'chunk', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
}

export default function Call() {
  const { code } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role === 'teacher' ? 'teacher' : 'parent';
  const lang = LANG[role], otherLang = LANG[OTHER[role]];

  const [info, setInfo] = useState(null);          // { teacher_name, ice_servers }
  const [stage, setStage] = useState('lobby');     // lobby → waiting → live → ended | gone
  const [peerName, setPeerName] = useState(role === 'teacher' ? 'Parent' : '');
  const [phase, setPhaseState] = useState({ name: 'idle' }); // idle | recording | translating | sent | remote | remoteTranslating | playing
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [orb, setOrb] = useState(null);

  const phaseRef = useRef(phase);
  const setPhase = p => { phaseRef.current = p; setPhaseState(p); };
  const pc = useRef(null), channel = useRef(null), session = useRef(0), pendingIce = useRef([]);
  const cam = useRef(null), remoteStream = useRef(null), selfVideo = useRef(null), remoteVideo = useRef(null);
  const recorder = useRef(null), startedAt = useRef(0), history = useRef([]), chunks = useRef({});
  const lastSignal = useRef(0), polling = useRef(null), live = useRef(false), stageRef = useRef(stage);
  const bloom = useRef(null), micButton = useRef(null), remoteTile = useRef(null), stopPlayback = useRef(null);
  stageRef.current = stage;

  useEffect(() => {
    api.callInfo(code).then(i => { setInfo(i); if (role === 'parent') setPeerName(i.teacher_name); }, () => setStage('gone'));
  }, [code, role]);

  // Video elements are re-created between stages; give them their streams back each time.
  useEffect(() => {
    if (selfVideo.current && cam.current) selfVideo.current.srcObject = cam.current;
    if (remoteVideo.current && remoteStream.current) remoteVideo.current.srcObject = remoteStream.current;
  });

  // Leaving the page: tell the other side, release camera and connection.
  useEffect(() => {
    const bye = () => fetch(`/api/calls/${code}/signal`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, type: 'bye' }) });
    window.addEventListener('pagehide', bye);
    return () => { window.removeEventListener('pagehide', bye); if (live.current) bye(); teardown(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // keep the newest caption in view
    document.querySelectorAll('.call-captions .list').forEach(el => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  }, [transcript.length]);

  // Handoff light (same stages as the in-person meeting): start → travel → arrive | gone
  useEffect(() => {
    if (orb?.stage === 'start') {
      let second;
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setOrb(o => (o?.stage === 'start' ? { ...o, stage: 'travel' } : o))); });
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }
    if (orb?.stage === 'arrive' || orb?.stage === 'gone') {
      const timer = setTimeout(() => setOrb(null), orb.stage === 'arrive' ? 450 : 220);
      return () => clearTimeout(timer);
    }
  }, [orb?.stage]);
  function launchOrb(fromEl, toEl) {
    if (!fromEl || !toEl) return;
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    setOrb({ key: Date.now(), x: ax, y: ay, dx: b.left + b.width / 2 - ax, dy: b.top + b.height / 2 - ay, stage: 'start' });
  }
  const landOrb = () => setOrb(o => o && { ...o, stage: 'arrive' });
  const fadeOrb = () => setOrb(o => (o && o.stage !== 'arrive' ? { ...o, stage: 'gone' } : o));

  // --- Joining: one deliberate tap grants the camera AND unlocks audio on iPhone ---

  async function join() {
    audioContext();
    unlockPlayer();
    setError('');
    try {
      cam.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
    } catch {
      setNote(say(lang, 'Caméra non disponible : l’autre personne ne vous verra pas.', 'Camera unavailable: the other person won’t see you.'));
    }
    setStage('waiting');
    live.current = true;
    await api.signal(code, role, 'hello').catch(e => setError(e.message));
    poll();
  }

  async function poll() {
    if (!live.current) return;
    try {
      for (const m of await api.signals(code, role, lastSignal.current)) {
        lastSignal.current = m.n;
        await onSignal(m);
      }
    } catch (e) {
      if (e.status === 404) return finish(false, 'gone');
    }
    polling.current = setTimeout(poll, channel.current?.readyState === 'open' ? 2000 : 500); // slower once connected
  }

  // --- WebRTC setup. Each attempt has a session id so a refresh on either side starts clean. ---

  function makePeer(id) {
    pc.current?.close();
    session.current = id;
    pendingIce.current = [];
    const peer = new RTCPeerConnection({ iceServers: info?.ice_servers ?? [{ urls: 'stun:stun.l.google.com:19302' }] });
    const tracks = cam.current?.getVideoTracks() ?? [];
    if (tracks.length) tracks.forEach(t => peer.addTrack(t, cam.current));
    else peer.addTransceiver('video', { direction: 'recvonly' }); // no camera: still receive theirs
    peer.ontrack = e => {
      remoteStream.current = e.streams[0] ?? new MediaStream([e.track]);
      if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream.current;
    };
    peer.onicecandidate = e => { if (e.candidate) api.signal(code, role, 'ice', { session: id, candidate: e.candidate.toJSON() }).catch(() => {}); };
    peer.onconnectionstatechange = () => {
      if (peer !== pc.current) return;
      if (peer.connectionState === 'failed') setNote(say(lang, 'Connexion impossible sur ce réseau.', 'Couldn’t connect on this network.'));
      if (peer.connectionState === 'connected') setNote('');
    };
    if (role === 'teacher') attach(peer.createDataChannel('parentbridge'));
    else peer.ondatachannel = e => attach(e.channel);
    pc.current = peer;
    return peer;
  }

  async function onSignal({ type, data }) {
    if (type === 'hello') {
      if (role === 'teacher') { // the parent arrived (or came back): start a fresh connection
        const peer = makePeer(Date.now());
        await peer.setLocalDescription(await peer.createOffer());
        await api.signal(code, role, 'offer', { session: session.current, sdp: peer.localDescription.toJSON() });
      } else {
        await api.signal(code, role, 'hello'); // the teacher came back: ask for a new offer
      }
    } else if (type === 'offer' && role === 'parent') {
      const peer = makePeer(data.session);
      await peer.setRemoteDescription(data.sdp);
      await peer.setLocalDescription(await peer.createAnswer());
      await api.signal(code, role, 'answer', { session: data.session, sdp: peer.localDescription.toJSON() });
      for (const c of pendingIce.current.splice(0)) await peer.addIceCandidate(c).catch(() => {});
    } else if (type === 'answer' && role === 'teacher' && data.session === session.current) {
      await pc.current.setRemoteDescription(data.sdp);
      for (const c of pendingIce.current.splice(0)) await pc.current.addIceCandidate(c).catch(() => {});
    } else if (type === 'ice' && data.session === session.current && pc.current) {
      if (pc.current.remoteDescription) await pc.current.addIceCandidate(data.candidate).catch(() => {});
      else pendingIce.current.push(data.candidate);
    } else if (type === 'end') {
      if (stageRef.current !== 'ended') finish(false);
    } else if (type === 'bye' && stageRef.current !== 'ended') {
      setStage('waiting');
      setNote(say(lang, 'L’autre personne a quitté l’appel. En attente…', 'The other person left. Waiting…'));
    }
  }

  function attach(ch) {
    ch.onopen = () => {
      channel.current = ch;
      setStage('live');
      setNote('');
      sendJson(ch, { t: 'hi', name: user?.name ?? (role === 'teacher' ? info?.teacher_name : 'Parent') });
    };
    ch.onmessage = e => onData(JSON.parse(e.data));
    ch.onclose = () => { if (live.current && channel.current === ch && stageRef.current === 'live') setStage('waiting'); }; // not after hanging up
  }

  // --- Messages from the other device ---

  function onData(msg) {
    if (msg.t === 'chunk') {
      const parts = (chunks.current[msg.id] ??= []);
      parts[msg.i] = msg.d;
      if (parts.filter(Boolean).length === msg.n) { delete chunks.current[msg.id]; onData(JSON.parse(parts.join(''))); }
      return;
    }
    const p = phaseRef.current;
    if (msg.t === 'hi') setPeerName(msg.name);
    else if (msg.t === 'floor') { // they started talking
      if (p.name === 'recording' && role === 'teacher') return; // both tapped at once: the teacher keeps the floor
      if (p.name === 'recording') cancelRecording();             // ...and the parent yields
      setError('');
      setPhase({ name: 'remote' });
    } else if (msg.t === 'free' && (p.name === 'remote' || p.name === 'remoteTranslating')) setPhase({ name: 'idle' });
    else if (msg.t === 'translating') {
      setPhase({ name: 'remoteTranslating' });
      launchOrb(remoteTile.current, micButton.current); // their words travel toward you
    } else if (msg.t === 'turn') playTurn(msg.turn, msg.audio);
    else if (msg.t === 'playing') landOrb();              // they're hearing it now: the light lands on their side
    else if (msg.t === 'done' && p.name === 'sent') { setPhase({ name: 'idle' }); fadeOrb(); }
    else if (msg.t === 'end' && stageRef.current !== 'ended') finish(false);
  }

  function addTurn(turn) {
    history.current = [...history.current, turn];
    setTranscript(history.current);
  }

  // Listener side: show the caption, play the translation on the unlocked player, glow teal.
  function playTurn(turn, audio_b64) {
    addTurn(turn);
    const done = () => {
      stopPlayback.current = null;
      glowStop();
      sendJson(channel.current, { t: 'done' });
      fadeOrb();
      setPhase({ name: 'idle' });
    };
    if (!audio_b64) return done();
    let envelope = null;
    envelopeOf(audio_b64).then(e => { envelope = e; }, () => {});
    player.onplaying = () => {
      setPhase({ name: 'playing' });
      sendJson(channel.current, { t: 'playing' });
      landOrb();
      glowFollow(bloom.current, () => (envelope?.[Math.floor(player.currentTime * 50)] ?? 0.05) * 0.4);
      bloom.current?.style.setProperty('--glow', TEAL);
    };
    player.onended = player.onerror = done;
    stopPlayback.current = () => { player.pause(); done(); };
    player.src = 'data:audio/mpeg;base64,' + audio_b64;
    player.play().catch(done);
  }

  // --- Speaker side: push-to-talk (mic only open while talking, as in person) ---

  function startTalking() {
    if (channel.current?.readyState !== 'open') return;
    audioContext();
    unlockPlayer();
    setError('');
    sendJson(channel.current, { t: 'floor' });
    startedAt.current = performance.now();
    setPhase({ name: 'recording' });
    bloom.current?.style.setProperty('--glow', PURPLE);
    glowFollow(bloom.current, fakeVoice);
    recorder.current = 'pending';
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      if (recorder.current !== 'pending') return stream.getTracks().forEach(t => t.stop());
      const analyser = analyserFor(audioContext().createMediaStreamSource(stream));
      glowFollow(bloom.current, () => loudness(analyser));
      const parts = [];
      const rec = new MediaRecorder(stream, { mimeType });
      rec.ondataavailable = e => parts.push(e.data);
      rec.start();
      recorder.current = { rec, parts, stream };
    }, () => {
      recorder.current = null;
      glowStop();
      setPhase({ name: 'idle' });
      sendJson(channel.current, { t: 'free' });
      setError(say(lang, 'Micro non disponible', 'Microphone not available'));
    });
  }

  function cancelRecording() {
    const r = typeof recorder.current === 'object' ? recorder.current : null;
    recorder.current = null;
    glowStop();
    if (r) { r.rec.onstop = () => r.stream.getTracks().forEach(t => t.stop()); r.rec.stop(); }
  }

  function stopTalking() {
    const r = typeof recorder.current === 'object' ? recorder.current : null;
    recorder.current = null;
    glowStop();
    if (!r || performance.now() - startedAt.current < 500) { // accidental tap, or the mic never opened
      if (r) { r.rec.onstop = () => r.stream.getTracks().forEach(t => t.stop()); r.rec.stop(); }
      sendJson(channel.current, { t: 'free' });
      return setPhase({ name: 'idle' });
    }
    setPhase({ name: 'translating' });
    sendJson(channel.current, { t: 'translating' });
    launchOrb(micButton.current, remoteTile.current); // your words travel toward them
    r.rec.onstop = () => { r.stream.getTracks().forEach(t => t.stop()); sendTurn(new Blob(r.parts, { type: mimeType })); };
    r.rec.stop();
  }

  async function sendTurn(blob) {
    try {
      const { audio_b64, ...turn } = await api.turn(blob, role, history.current.slice(-6));
      addTurn(turn); // your caption appears right away
      setPhase({ name: 'sent' });
      sendJson(channel.current, { t: 'turn', turn, audio: audio_b64 });
      setTimeout(() => { if (phaseRef.current.name === 'sent') { setPhase({ name: 'idle' }); fadeOrb(); } }, 60000); // never stay locked
    } catch (e) {
      setError(e.message === 'No speech detected' ? say(lang, 'Aucune parole détectée · Réessayez', 'No speech detected · Try again') : e.message);
      sendJson(channel.current, { t: 'free' });
      setPhase({ name: 'idle' });
      fadeOrb();
    }
  }

  function onMic() {
    const p = phaseRef.current.name;
    if (p === 'playing') stopPlayback.current?.();
    else if (p === 'recording') stopTalking();
    else if (p === 'idle') startTalking();
  }

  // --- Ending ---

  function teardown() {
    live.current = false;
    clearTimeout(polling.current);
    stopPlayback.current?.();
    cancelRecording();
    channel.current?.close();
    pc.current?.close();
    cam.current?.getTracks().forEach(t => t.stop());
  }

  function finish(tellOther, endStage = 'ended') {
    if (!live.current && stageRef.current === endStage) return; // already finished (end can arrive twice)
    stageRef.current = endStage; // right away: the channel's onclose fires before React re-renders
    if (tellOther) { // both ways: the data channel is closing right after this, the server mailbox isn't
      sendJson(channel.current, { t: 'end' });
      api.signal(code, role, 'end').catch(() => {});
    } else api.signal(code, role, 'bye').catch(() => {});
    teardown();
    if (role === 'teacher' && endStage === 'ended' && history.current.length) {
      navigate('/summary', { state: { transcript: history.current } }); // the teacher's device writes and saves the summary
    } else setStage(endStage);
  }

  // --- Screens ---

  if (stage === 'gone') {
    return (
      <main className="call-center"><div className="card page">
        <h1>{say(lang, 'Appel introuvable', 'Call not found')}</h1>
        <p className="sub">Appel introuvable ou terminé · Call not found or ended</p>
        <Link className="btn primary" to="/">ParentBridge</Link>
      </div></main>
    );
  }
  if (stage === 'ended') {
    return (
      <main className="call-center"><div className="card page">
        <h1>{say(lang, 'Appel terminé', 'Call ended')}</h1>
        <p className="sub">
          {role === 'parent'
            ? say(lang, `${peerName || 'L’enseignant'} enregistre le résumé. Connectez-vous pour le voir dans votre tableau de bord.`, `${peerName || 'The teacher'} is saving the summary. Sign in to see it on your dashboard.`)
            : say(lang, 'Aucun échange à résumer.', 'Nothing was said, so there is no summary.')}
        </p>
        <Link className="btn primary" to={user ? '/dashboard' : '/login'}>{user ? say(lang, 'Tableau de bord', 'Dashboard') : say(lang, 'Se connecter', 'Sign in')}</Link>
      </div></main>
    );
  }
  if (stage === 'lobby') {
    return (
      <main className="call-center"><div className="card page">
        {role === 'teacher' ? (
          <>
            <h1>Appel vidéo · Video call</h1>
            <p className="sub">Léo Martin · {say(lang, 'Le parent entendra la traduction en français.', 'The parent will hear the translation in French.')}</p>
          </>
        ) : (
          <>
            <h1 lang="fr">{info ? `${info.teacher_name} vous invite à un appel vidéo` : 'Appel vidéo'}</h1>
            <p className="sub">invited you to a video call · Léo Martin</p>
            <p className="sub">Vous entendrez la traduction en français. · You’ll hear the translation in your language.</p>
          </>
        )}
        <button className="btn primary wide" onClick={join} disabled={!info}>
          {role === 'teacher' ? 'Démarrer l’appel · Start call' : 'Rejoindre l’appel · Join call'}
        </button>
        {error && <p className="form-error">{error}</p>}
      </div></main>
    );
  }

  const link = `${location.origin}/#/call/${code}`;
  const busy = phase.name !== 'idle' && phase.name !== 'recording' && phase.name !== 'playing';
  const status =
    error ? error
    : phase.name === 'recording' ? say(lang, 'Écoute en cours… touchez pour arrêter', 'Listening… tap to stop')
    : phase.name === 'translating' ? say(lang, 'Traduction…', 'Translating…')
    : phase.name === 'sent' ? say(lang, `${peerName} entend la traduction…`, `${peerName} is hearing the translation…`)
    : phase.name === 'remote' ? say(lang, `${peerName} parle…`, `${peerName} is speaking…`)
    : phase.name === 'remoteTranslating' ? say(lang, 'Traduction…', 'Translating…')
    : phase.name === 'playing' ? say(lang, 'Lecture de la traduction… touchez pour passer', 'Playing translation… tap to skip')
    : stage === 'live' ? say(lang, 'Touchez pour parler', 'Tap to speak') : '';

  return (
    <>
      <main className={`call ${stage}`}>
        <div ref={remoteTile} className={`remote${phase.name === 'remote' ? ' talking' : ''}`}>
          {stage === 'live'
            ? <video ref={remoteVideo} autoPlay playsInline muted />
            : (
              <div className="waiting">
                <h2 className="eyebrow">{say(lang, `En attente de ${peerName || 'l’autre personne'}…`, `Waiting for ${peerName || 'the other person'}…`)}</h2>
                {role === 'teacher' && (
                  <>
                    <p>{say(lang, 'Envoyez ce lien au parent :', 'Send this link to the parent:')}</p>
                    <div className="share">
                      <input readOnly value={link} onFocus={e => e.target.select()} aria-label="Call link" />
                      <button className="btn primary" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
                        {copied ? 'Copié · Copied' : 'Copier · Copy'}
                      </button>
                    </div>
                  </>
                )}
                {role === 'parent' && <p>{say(lang, 'Connexion…', 'Connecting…')}</p>}
              </div>
            )}
          {stage === 'live' && <span className="call-tag">{peerName} · {LANG_NAME[otherLang]}</span>}
          <video ref={selfVideo} className="self" autoPlay playsInline muted />
        </div>

        <aside className="call-captions">
          <h2 className="eyebrow">Sous-titres · Captions</h2>
          <div className="list">
            {transcript.length === 0 && <p className="muted">{say(lang, 'Les sous-titres apparaîtront ici.', 'Captions will appear here.')}</p>}
            {transcript.map((turn, i) => {
              const mine = turn.speaker === role;
              const main = mine ? turn.source_text : turn.target_text, sub = mine ? turn.target_text : turn.source_text;
              return (
                <div key={i} className={`cap${i === transcript.length - 1 ? ' latest' : ''}`} lang={lang}>
                  <span className="label">{mine ? say(lang, 'Vous', 'You') : `${peerName} · ${say(lang, 'traduction', 'translation')}`}</span>
                  <p>{main}</p>
                  <small lang={otherLang}>{sub}</small>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="call-bar">
          <div className={`status${error ? ' error' : ''}`}>{note || status}</div>
          <div className="call-mic">
            <div className={`bloom${phase.name === 'recording' || phase.name === 'playing' ? ' on' : ''}`}><i ref={bloom} /></div>
            <button ref={micButton}
                    className={`mic${phase.name === 'translating' ? ' loading' : ''}${phase.name === 'playing' ? ' playing' : ''}`}
                    aria-pressed={phase.name === 'recording'} aria-busy={phase.name === 'translating'}
                    disabled={stage !== 'live' || busy} onClick={onMic}
                    aria-label={say(lang, 'Touchez pour parler', 'Tap to speak')}>
              {phase.name === 'recording' ? <StopIcon /> : phase.name === 'translating' ? <Dots /> : phase.name === 'playing' ? <SpeakerIcon /> : <MicIcon />}
            </button>
          </div>
          <button className="btn end" onClick={() => setConfirming(true)} disabled={phase.name === 'recording' || phase.name === 'translating'}>
            <span className="long">Raccrocher · End call</span>
            <span className="short">{say(lang, 'Raccrocher', 'End call')}</span>
          </button>
        </div>
      </main>

      {orb && <div key={orb.key} className={`orb ${orb.stage}`} style={{ left: orb.x, top: orb.y, '--dx': `${orb.dx}px`, '--dy': `${orb.dy}px` }} />}
      <ConfirmDialog lang={lang} open={confirming} onClose={result => { setConfirming(false); if (result === 'end') finish(true); }} />
    </>
  );
}
