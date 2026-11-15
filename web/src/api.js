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
  // Video calls: setup messages only (video and turns then go peer to peer)
  createCall: () => request('/api/calls', { method: 'POST' }),
  callInfo: code => request(`/api/calls/${encodeURIComponent(code)}`),
  signal: (code, role, type, data) => request(`/api/calls/${encodeURIComponent(code)}/signal`, jsonPost({ role, type, data })),
  signals: (code, role, after) => request(`/api/calls/${encodeURIComponent(code)}/signal?role=${role}&after=${after}`),
  // Follow-up agent: the server streams one JSON object per line (steps as they happen, then the result)
  async agent(id, onStep) {
    const res = await fetch(`/api/meetings/${id}/agent`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw Object.assign(new Error(data.error || `Server error (${res.status})`), { status: res.status });
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '', result = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const lines = (buffer + value).split('\n');
      buffer = lines.pop(); // an unfinished line waits for the next chunk
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.type === 'step') onStep(event);
        else if (event.type === 'error') throw new Error(event.error);
        else result = event;
      }
    }
    if (!result) throw new Error('Suivi impossible, réessayez · Follow-up failed, please try again');
    return result;
  },
  sendFollowup: (id, message) => request(`/api/meetings/${id}/followup`, jsonPost(message)),
  followupAudio: id => fetch(`/api/meetings/${id}/followup/audio`).then(async res => {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server error (${res.status})`);
    return res.arrayBuffer();
  }),
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

const MOCK_AGENT = {
  steps: [
    { fr: '3 rencontres lues pour Léo', en: 'Read 3 meetings about Léo' },
    { fr: '« IEP » vérifié dans le glossaire de l’école', en: 'Looked up “IEP” in the school glossary' },
    { fr: '3 actions encore ouvertes, dont 1 en retard', en: '3 action items still open, 1 overdue' },
    { fr: 'Message rédigé pour M. Martin, en français', en: 'Drafted a message for Mr. Martin, in French' },
  ],
  result: {
    open_items: [
      { owner: 'Teacher', task_en: 'Send math practice sheets home', task_fr: "Envoyer des fiches d'exercices à la maison", due: 'November 10', status: 'overdue' },
      { owner: 'Parent', task_en: 'Sign the consent form', task_fr: 'Signer le formulaire de consentement', due: 'Friday', status: 'open' },
      { owner: 'Teacher', task_en: 'Start math support twice a week', task_fr: 'Commencer le soutien en mathématiques', due: 'March 3', status: 'open' },
    ],
    message_en: 'Hello Mr. Martin, thank you for meeting with me. A quick reminder: please sign the consent form by Friday so Léo can start math support on March 3. I owe you the practice sheets; they are on their way this week. An IEP is an individualized education plan: a support plan made for Léo.',
    message_fr: "Bonjour Monsieur Martin, merci pour notre rencontre. Petit rappel : veuillez signer le formulaire de consentement d'ici vendredi, afin que Léo puisse commencer le soutien en mathématiques le 3 mars. Je vous dois les fiches d'exercices : elles partent cette semaine. Un IEP est un plan d'éducation individualisé : un plan d'aide fait pour Léo.",
    next_questions_en: ['How is math support going so far?', 'Has the IEP evaluation been scheduled?'],
    next_questions_fr: ['Comment se passe le soutien en mathématiques ?', "L'évaluation pour l'IEP a-t-elle été planifiée ?"],
  },
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
    local.set('pb-mock-teacher', 'Mr. Tremblay');
    return { name: 'Mr. Tremblay', role: 'teacher' };
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
  async agent(_id, onStep) {
    for (const step of MOCK_AGENT.steps) { await sleep(700); onStep(step); }
    return MOCK_AGENT.result;
  },
  async sendFollowup(id, message) {
    const followup = { ...message, teacher: 'Mr. Tremblay', sent_at: new Date().toISOString() };
    local.set('pb-mock-meetings', (await mockApi.meetings()).map(m => (m.id === id ? { ...m, followup } : m)));
    return followup;
  },
  async followupAudio() { throw new Error('Pas de voix en mode démo · No voice in mock mode'); },
  async turn(_blob, speaker) {
    await sleep(1200); // roughly the real round trip, so the translating state is visible
    const lines = MOCK_LINES[speaker];
    const [source_text, target_text] = lines[mockCount[speaker]++ % lines.length];
    const source_lang = LANG[speaker];
    return { speaker, source_lang, target_lang: source_lang === 'fr' ? 'en' : 'fr', source_text, target_text, audio_b64: '' };
  },
};

export const api = MOCK ? mockApi : realApi;
