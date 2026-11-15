// Web Audio helpers + the speaking glow loop. Kept outside React on purpose:
// the glow changes every frame, and React state at 60 fps would re-render the whole page.

let ctx = null;
export function audioContext() { // first call must happen inside a tap (browsers block audio until a user gesture)
  ctx ??= new AudioContext();
  ctx.resume();
  return ctx;
}

export function analyserFor(sourceNode) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  sourceNode.connect(analyser);
  return analyser;
}

export function loudness(analyser) { // RMS of the waveform, roughly 0–0.3 for speech
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += ((v - 128) / 128) ** 2;
  return Math.sqrt(sum / buf.length);
}

export const fakeVoice = () => 0.08 + 0.06 * Math.sin(performance.now() / 90); // mock mode: no real signal

// --- Playback that works on iPhone/iPad (every iOS browser is WebKit) ---
// 1. One plain <audio> element for every translation. iOS only lets an element make sound after a tap has
//    "unlocked" it, and our audio arrives after a network wait, so we unlock it inside the mic tap.
// 2. Sound never goes through Web Audio: on iOS, Web Audio output is muted by the silent switch.
//    The teal glow instead follows a loudness curve decoded from the same mp3 (see envelopeOf).
export const player = new Audio();
let unlocked = false;

function silentWav() { // 0.1 s of silence, built in code so there's no asset to ship
  const n = 800, buf = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt ');
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, 8000, true); buf.setUint32(28, 16000, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  text(36, 'data'); buf.setUint32(40, n * 2, true);
  return 'data:audio/wav;base64,' + btoa(String.fromCharCode(...new Uint8Array(buf.buffer)));
}

export function unlockPlayer() { // call from inside a tap
  if (unlocked) return;
  player.src = silentWav();
  player.play().then(() => { player.pause(); unlocked = true; }).catch(() => {});
}

// Loudness of an mp3 in 20 ms steps (RMS), so the glow can follow the voice without routing sound through Web Audio.
export async function envelopeOf(base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const decoded = await audioContext().decodeAudioData(bytes.buffer);
  const data = decoded.getChannelData(0), step = Math.round(decoded.sampleRate / 50), env = [];
  for (let i = 0; i < data.length; i += step) {
    let sum = 0;
    const end = Math.min(i + step, data.length);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    env.push(Math.sqrt(sum / (end - i)));
  }
  return env;
}

// Glow: one bloom element at a time follows an audio level.
// Writes transform/opacity straight onto that element (no inherited CSS variable, so no style recalc of children).
let target = null, readLevel = null, level = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function glowFollow(element, reader) { target = element; readLevel = reader; level = 0; }
export function glowStop() { readLevel = null; } // level eases back down; the bloom also fades out via CSS

(function tick() {
  const goal = readLevel ? Math.min(1, readLevel() * 5) : 0;
  level += (goal - level) * (goal > level ? 0.5 : 0.12); // rise fast with the voice, fall slowly: swells, no flicker
  if (target && !reducedMotion.matches) {
    target.style.transform = `scale(${0.7 + level * 0.8})`;
    target.style.opacity = 0.4 + level * 0.6;
  }
  requestAnimationFrame(tick);
})();
