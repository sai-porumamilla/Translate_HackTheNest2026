import { other, say, useLang } from '../lang.jsx';

// Shared by /summary (right after a meeting) and /meetings/:id (a past meeting).
// summary = null shows skeleton lines while /api/summary runs, so nothing jumps when it arrives.
// Viewer-first: the viewer's language is the main card; the other language is a quieter echo beside it.
const Bars = ({ n }) => Array.from({ length: n }, (_, i) => <span key={i} className="bar" />);
const OWNER = { Teacher: { fr: 'Enseignant', en: 'Teacher' }, Parent: { fr: 'Parent', en: 'Parent' } };

export default function SummaryView({ title, note, summary, actions, top, children }) {
  const lang = useLang(), alt = other(lang);
  const column = (l, main) => (
    <div lang={l} className={main ? 'main' : 'echo'}>
      <h2 className="eyebrow">{say(l, 'Résumé', 'Summary')}</h2>
      {summary ? <p>{summary[`summary_${l}`]}</p> : <Bars n={main ? 4 : 2} />}
    </div>
  );
  return (
    <main className="summary page">
      <h1>{title}</h1>
      {note && <p className={`saved${note.isError ? ' error' : ''}`}>{note.text}</p>}
      {top}
      <div className="cols">{column(lang, true)}{column(alt, false)}</div>
      <table>
        <thead>
          <tr>
            <th>{say(lang, 'Responsable', 'Owner')}</th>
            <th>{say(lang, 'Tâche', 'Task')}</th>
            <th className="echo" lang={alt}>{say(alt, 'Tâche', 'Task')}</th>
            <th>{say(lang, 'Échéance', 'Due')}</th>
          </tr>
        </thead>
        <tbody>
          {summary
            ? summary.action_items.map((item, i) => (
                <tr key={i}>
                  <td>{OWNER[item.owner]?.[lang] ?? item.owner}</td>
                  <td lang={lang}>{item[`task_${lang}`]}</td>
                  <td className="echo" lang={alt}>{item[`task_${alt}`]}</td>
                  <td>{item.due}</td>
                </tr>
              ))
            : [0, 1, 2].map(i => <tr key={i}><td colSpan={4}><span className="bar" /></td></tr>)}
        </tbody>
      </table>
      {children}
      <div className="row">{actions}</div>
    </main>
  );
}
