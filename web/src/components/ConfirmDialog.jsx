import { useEffect, useRef } from 'react';

// "End meeting?" — native <dialog> gives focus trapping and Esc-to-cancel for free.
// onClose receives "end" when confirmed; anything else (Cancel, Esc, backdrop click) means cancel.
export default function ConfirmDialog({ open, onClose }) {
  const ref = useRef(null);

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
        <h1 lang="fr">Terminer la rencontre ?</h1>
        <p className="sub">End meeting?</p>
        <p>
          <span lang="fr">Vous verrez le résumé et les prochaines étapes. La conversation ne pourra pas reprendre.</span><br />
          You'll see the summary and next steps. The conversation can't be resumed.
        </p>
        <div className="row end">
          <button className="btn" value="cancel" autoFocus>Annuler · Cancel</button>
          <button className="btn primary" value="end">Terminer · End</button>
        </div>
      </form>
    </dialog>
  );
}
