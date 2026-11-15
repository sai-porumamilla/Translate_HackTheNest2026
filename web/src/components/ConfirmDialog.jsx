import { useEffect, useRef } from 'react';
import { Bi, other, say, useLang } from '../lang.jsx';

// "End meeting?" — native <dialog> gives focus trapping and Esc-to-cancel for free.
// onClose receives "end" when confirmed; anything else (Cancel, Esc, backdrop click) means cancel.
export default function ConfirmDialog({ open, onClose, lang: forced }) {
  const ref = useRef(null);
  const viewer = useLang();
  const lang = forced || viewer;

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) {
      dialog.returnValue = '';
      dialog.showModal();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    const handle = () => onClose(dialog.returnValue);
    dialog.addEventListener('close', handle);
    return () => dialog.removeEventListener('close', handle);
  }, [onClose]);

  return (
    <dialog ref={ref} className="confirm" onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <form method="dialog">
        <h1 lang={lang}>{say(lang, 'Terminer la rencontre ?', 'End meeting?')}</h1>
        <p className="sub" lang={other(lang)}>{say(lang, 'End meeting?', 'Terminer la rencontre ?')}</p>
        <p lang={lang}>{say(lang, 'Vous verrez le résumé et les prochaines étapes. La conversation ne pourra pas reprendre.',
          "You'll see the summary and next steps. The conversation can't be resumed.")}</p>
        <div className="row end">
          <button className="btn" value="cancel" autoFocus><Bi fr="Annuler" en="Cancel" lang={lang} /></button>
          <button className="btn primary" value="end"><Bi fr="Terminer" en="End" lang={lang} /></button>
        </div>
      </form>
    </dialog>
  );
}
