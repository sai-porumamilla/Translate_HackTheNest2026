// Shared by /summary (right after a meeting) and /meetings/:id (a past meeting).
// summary = null shows skeleton lines while /api/summary runs, so nothing jumps when it arrives.
const Bars = ({ n }) => Array.from({ length: n }, (_, i) => <span key={i} className="bar" />);

export default function SummaryView({ title, note, summary, actions }) {
  return (
    <main className="summary page">
      <h1>{title}</h1>
      {note && <p className={`saved${note.isError ? ' error' : ''}`}>{note.text}</p>}
      <div className="cols">
        <div lang="fr"><h2 className="eyebrow">Résumé</h2>{summary ? <p>{summary.summary_fr}</p> : <Bars n={4} />}</div>
        <div lang="en"><h2 className="eyebrow">Summary</h2>{summary ? <p>{summary.summary_en}</p> : <Bars n={4} />}</div>
      </div>
      <table>
        <thead><tr><th>Owner</th><th>Task EN</th><th>Tâche FR</th><th>Due</th></tr></thead>
        <tbody>
          {summary
            ? summary.action_items.map((item, i) => (
                <tr key={i}><td>{item.owner}</td><td>{item.task_en}</td><td lang="fr">{item.task_fr}</td><td>{item.due}</td></tr>
              ))
            : [0, 1, 2].map(i => <tr key={i}><td colSpan={4}><span className="bar" /></td></tr>)}
        </tbody>
      </table>
      <div className="row">{actions}</div>
    </main>
  );
}
