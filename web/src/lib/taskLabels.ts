import type { Task } from '../types';

/**
 * One place for how an activity is named. "Assigned" / "Unassigned" is the task's
 * persisted activity_origin (admin-created vs. started by the employee in the
 * field), not a guess from whether someone is assigned.
 *
 * Direct Installation (pamphlet distribution) and Installation Without Recee keep
 * their existing, distinct meanings.
 */
const INSTALL_LABEL: Record<string, string> = {
  post_recee: 'Installation (After Recee)',
  direct: 'Direct Installation',
  direct_boarding: 'Installation Without Recee',
};

export function taskTypeLabel(t: Pick<Task, 'task_type' | 'installation_type' | 'activity_origin'>): string {
  const unassigned = t.activity_origin === 'UNASSIGNED';
  if (t.task_type === 'recee') return unassigned ? 'Unassigned Recee' : 'Assigned Recee';
  const base = (t.installation_type && INSTALL_LABEL[t.installation_type]) || 'Installation';
  return unassigned ? `Unassigned ${base}` : base;
}
