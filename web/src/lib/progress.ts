import type { TaskLookupRow } from '../api';

export type StageState = 'done' | 'current' | 'todo' | 'bad';
export interface Stage { label: string; state: StageState; at: string | null }

/**
 * How far a task has got, as a short list of stages. A recee also tracks the
 * installation spawned from it, because that is the rest of the same job.
 */
export function progressStages(t: TaskLookupRow): Stage[] {
  const st = (done: boolean, label: string, at: string | null): Stage => ({ label, state: done ? 'done' : 'todo', at: done ? at : null });
  let stages: Stage[];

  if (t.task_type === 'recee') {
    const rejected = t.status === 'recee_rejected';
    const approved = ['recee_approved', 'installed', 'completed'].includes(t.status);
    const submitted = !!t.first_submitted || t.status !== 'pending';
    stages = [
      st(true, 'Created', t.created_at),
      st(submitted, 'Recee submitted', t.first_submitted),
      rejected
        ? { label: 'Rejected — rework', state: 'bad', at: t.reviewed_at }
        : st(approved, 'Recee approved', t.reviewed_at),
      st(t.child_status === 'completed', 'Installation', t.child_completed_at),
    ];
  } else if (t.installation_type === 'post_recee') {
    stages = [st(true, 'Created', t.created_at), st(t.status === 'completed', 'Installed', t.completed_at)];
  } else {
    stages = [st(true, 'Created', t.created_at), st(t.status === 'completed', 'Completed', t.completed_at)];
  }
  if (t.status === 'cancelled') return stages.map((s) => (s.state === 'done' ? s : { ...s, state: 'todo' as const }));

  // The first unfinished stage is where the task is now.
  const i = stages.findIndex((s) => s.state === 'todo');
  if (i >= 0) stages[i] = { ...stages[i], state: 'current' };
  return stages;
}
