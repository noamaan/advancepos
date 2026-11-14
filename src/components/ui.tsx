import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

// ── Toast bus ───────────────────────────────────────────────────────────────
type Kind = 'ok' | 'err' | 'info';
interface Toast { id: number; kind: Kind; text: string }
const ToastCtx = createContext<(kind: Kind, text: string) => void>(() => undefined);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-tray">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ── Modal ───────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ── Confirm dialog ──────────────────────────────────────────────────────────
export function ConfirmDialog({ text, onYes, onNo, danger }: { text: string; onYes: () => void; onNo: () => void; danger?: boolean }) {
  return (
    <Modal title="Please confirm" onClose={onNo}>
      <p style={{ marginTop: 0 }}>{text}</p>
      <div className="row-end">
        <button className="btn" onClick={onNo}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onYes}>Yes, proceed</button>
      </div>
    </Modal>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? `tone-${tone}` : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({ text, hint }: { text: string; hint?: string }) {
  return <div className="empty"><div className="empty-icon">▦</div><div>{text}</div>{hint && <div className="empty-hint">{hint}</div>}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <div className="spinner-wrap"><div className="spinner" />{label && <span>{label}</span>}</div>;
}
