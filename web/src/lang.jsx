import { LANG } from './api.js';
import { useAuth } from './auth.jsx';

// Viewer-first language: whoever is looking reads their own language first; the other one is a quiet echo after it.
// Teacher = English, parent = French, signed out = the browser's language.
const browserLang = navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';

export const other = lang => (lang === 'fr' ? 'en' : 'fr');
export const say = (lang, fr, en) => (lang === 'fr' ? fr : en);
// "Mr. Tremblay" reads "M. Tremblay" in French, and "M. Martin" reads "Mr. Martin" in English.
export const titled = (lang, name = '') => (lang === 'fr' ? name.replace(/^Mr\.? /, 'M. ') : name.replace(/^M\. /, 'Mr. '));
export const dateFor = lang => new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' });

export function useLang() {
  const user = useAuth()?.user;
  return user ? LANG[user.role] : browserLang;
}

// <Bi fr="Déconnexion" en="Sign out" />, or <Bi text={error} /> for the server's "Français · English" messages.
export function Bi({ fr, en, text, lang: forced }) {
  const viewer = useLang();
  const lang = forced || viewer; // a video call knows its side's language even when signed out
  if (text !== undefined) {
    const i = text.indexOf(' · ');
    if (i < 0) return text; // not bilingual (e.g. "Server error (500)")
    [fr, en] = [text.slice(0, i), text.slice(i + 3)];
  }
  return <><span lang={lang}>{say(lang, fr, en)}</span> <span className="alt" lang={other(lang)}>{say(lang, en, fr)}</span></>;
}
