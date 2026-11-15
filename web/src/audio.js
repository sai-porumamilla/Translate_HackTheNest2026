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
