// Every call to the backend lives here. The shapes follow the API contract in CLAUDE.md.
// With ?mock=1 in the URL (e.g. http://localhost:5173/?mock=1#/login) everything is faked in the browser.

export const MOCK = new URLSearchParams(location.search).has('mock');
export const LANG = { parent: 'fr', teacher: 'en' };
export const STUDENT = 'Léo Martin'; // synthetic demo student
export const dateFormat = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Server error (${res.status})`), { status: res.status });
  return data;
}
const jsonPost = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const realApi = {
  me: () => request('/api/me'),
  login: (email, password) => request('/api/login', jsonPost({ email, password })),
  logout: () => request('/api/logout', { method: 'POST' }),
  meetings: () => request('/api/meetings'),
  saveMeeting: meeting => request('/api/meetings', jsonPost(meeting)),
  summary: transcript => request('/api/summary', jsonPost({ transcript })),
  turn(blob, speaker, history) {
    const form = new FormData();
    form.append('audio', blob, blob.type.startsWith('audio/webm') ? 'turn.webm' : 'turn.mp4');
    form.append('speaker', speaker);
    form.append('history', JSON.stringify(history)); // last 6 turns, without audio
    return request('/api/turn', { method: 'POST', body: form });
  },
};

// --- Mock mode: demo-script turns, a canned summary, and login + meetings kept in localStorage (password "demo") ---

const MOCK_LINES = {
  teacher: [
    ["Léo is doing well in reading, but he's below benchmark in math.",
     "Léo progresse bien en lecture, mais il est en dessous du niveau attendu en mathématiques."],
    ["We'd like to start math support twice a week beginning March 3, and we can discuss an IEP evaluation.",
     "Nous aimerions commencer un soutien en mathématiques deux fois par semaine à partir du 3 mars, et nous pouvons discuter d'une évaluation pour un plan d'éducation individualisé (IEP)."],
    ["Please sign the consent form by Friday.",
     "Veuillez signer le formulaire de consentement d'ici vendredi."],
  ],
  parent: [
    ["Qu'est-ce que ça veut dire, en dessous du niveau ? Est-ce qu'il a besoin d'aide ?",
     "What does below level mean? Does he need help?"],
    ["D'accord. Qu'est-ce que je dois faire de mon côté ?",
     "Okay. What do I need to do on my end?"],
  ],
};
const mockCount = { teacher: 0, parent: 0 };

const MOCK_SUMMARY = {
  summary_en: "Léo is doing well in reading but is below benchmark in math. The school will start math support twice a week beginning March 3 and discuss an IEP evaluation. The parent will sign the consent form by Friday.",
  summary_fr: "Léo progresse bien en lecture, mais il est en dessous du niveau attendu en mathématiques. L'école commencera un soutien en mathématiques deux fois par semaine à partir du 3 mars et discutera d'une évaluation pour un IEP. Vous signerez le formulaire de consentement d'ici vendredi.",
  action_items: [
    { owner: 'Teacher', task_en: 'Start math support twice a week', task_fr: 'Commencer le soutien en mathématiques deux fois par semaine', due: 'March 3' },
    { owner: 'Teacher', task_en: 'Discuss an IEP evaluation', task_fr: "Discuter d'une évaluation pour un IEP", due: '' },
    { owner: 'Parent', task_en: 'Sign the consent form', task_fr: 'Signer le formulaire de consentement', due: 'Friday' },
  ],
};

const local = {
  get: (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: ignore */ } },
};
const authError = message => Object.assign(new Error(message), { status: 401 });

const mockApi = {
  async me() {
    const name = local.get('pb-mock-teacher', null);
    if (!name) throw authError('Not logged in');
    return { name, role: 'teacher' };
  },
  async login(email, password) {
    await sleep(400);
    if (password !== 'demo') throw authError('Wrong email or password');
    local.set('pb-mock-teacher', 'Ms. Tremblay');
    return { name: 'Ms. Tremblay', role: 'teacher' };
  },
  async logout() { local.set('pb-mock-teacher', null); return {}; },
  async meetings() { // seeded with one past meeting so the dashboard isn't empty on first look
    await sleep(300);
    const lastWeek = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    return local.get('pb-mock-meetings', [{ id: 1, created_at: lastWeek, student: STUDENT, ...MOCK_SUMMARY }]);
  },
  async saveMeeting(meeting) {
    const saved = { id: Date.now(), created_at: new Date().toISOString(), ...meeting };
    local.set('pb-mock-meetings', [saved, ...await mockApi.meetings()]);
    return { id: saved.id, created_at: saved.created_at };
  },
  async summary() { await sleep(1500); return MOCK_SUMMARY; },
  async turn(_blob, speaker) {
    await sleep(1200); // roughly the real round trip, so the translating state is visible
    const lines = MOCK_LINES[speaker];
    const [source_text, target_text] = lines[mockCount[speaker]++ % lines.length];
    const source_lang = LANG[speaker];
    return { speaker, source_lang, target_lang: source_lang === 'fr' ? 'en' : 'fr', source_text, target_text, audio_b64: '' };
  },
};

export const api = MOCK ? mockApi : realApi;
