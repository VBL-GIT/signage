import React from 'react';
import type { Task } from '../types';

export function Spinner() {
  return <div className="center-screen"><div className="spinner" /></div>;
}

export function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`card ${className ?? ''}`} style={style}>{children}</div>;
}

export function Button({ children, variant, size, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'secondary' | 'danger' | 'ghost'; size?: 'sm' }) {
  return <button className={`btn ${variant ?? ''} ${size ?? ''}`} {...rest}>{children}</button>;
}

export function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label>{label}</label>
      <input {...rest} />
    </div>
  );
}

export function Badge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ');
  return <span className={`badge ${status}`}>{label}</span>;
}

// A pending task means "not started yet" — but for the operator what matters is
// whether it's been assigned to an employee. Surface that (Assigned / Unassigned)
// instead of the raw "pending", and give the other statuses friendly labels.
const STATUS_LABELS: Record<string, string> = {
  recee_submitted: 'Recee Submitted',
  recee_approved: 'Recee Approved',
  recee_rejected: 'Recee Rejected',
  installed: 'Installed',
  completed: 'Completed',
};
export function taskStatusDisplay(task: Pick<Task, 'status' | 'employee_id'>): { key: string; label: string } {
  if (task.status === 'pending') {
    return task.employee_id ? { key: 'assigned', label: 'Assigned' } : { key: 'unassigned', label: 'Unassigned' };
  }
  return { key: task.status, label: STATUS_LABELS[task.status] ?? task.status.replace(/_/g, ' ') };
}
export function TaskBadge({ task }: { task: Pick<Task, 'status' | 'employee_id'> }) {
  const { key, label } = taskStatusDisplay(task);
  return <span className={`badge ${key}`}>{label}</span>;
}

export function ErrorBanner({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <div className="banner-error">{msg}</div>;
}

export interface SearchableOption { value: string; label: string; sublabel?: string }

/**
 * A <select> replacement with a search box, for reference lists that can grow
 * long (vendors, stores, brands, artworks…). Click/focus to open, type to
 * filter, click a row to pick. Blank value renders the placeholder as the
 * input's current text.
 */
export function SearchableSelect({
  options, value, onChange, placeholder = 'Select…', disabled,
}: {
  options: SearchableOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const boxRef = React.useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q))
    : options;

  return (
    <div className="searchable-select" ref={boxRef}>
      <input
        value={open ? query : (selected?.label ?? '')}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { setOpen(true); setQuery(''); }}
        placeholder={selected ? selected.label : placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {open && (
        <div className="combo-list">
          {value && (
            <div className="combo-row" onClick={() => { onChange(''); setOpen(false); setQuery(''); }}>
              <span className="muted">Clear selection</span>
            </div>
          )}
          {filtered.length === 0 && <div className="combo-row empty">No matches</div>}
          {filtered.map((o) => (
            <div
              key={o.value}
              className={`combo-row ${o.value === value ? 'sel' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
            >
              <span>
                {o.label}
                {o.sublabel && <span className="muted"> · {o.sublabel}</span>}
              </span>
              {o.value === value && <span style={{ color: 'var(--brand)', fontWeight: 700 }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
