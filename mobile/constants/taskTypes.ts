import { InstallationType, SignageType, Task } from '../types/domain';

export const SIGNAGE_TYPES: SignageType[] = ['nonlit', 'glow_sign_board', 'impact'];

export const SIGNAGE_TYPE_LABELS: Record<SignageType, string> = {
  nonlit: 'Nonlit',
  glow_sign_board: 'Glow Sign Board',
  impact: 'Impact',
};

export const TASK_TYPES = {
  recee: 'Recee',
  installation: 'Installation',
} as const;

export const INSTALLATION_TYPE_LABELS: Record<InstallationType, string> = {
  post_recee: 'Installation (After Recee)',
  direct: 'Direct Installation',
  direct_boarding: 'Installation Without Recee',
};

/**
 * Assigned / Unassigned is the task's persisted activity_origin: admin-created
 * work vs. work the employee started in the field.
 */
export function taskTypeLabel(task: Task): string {
  const unassigned = task.activity_origin === 'UNASSIGNED';
  if (task.task_type === 'recee') return unassigned ? 'Unassigned Recee' : 'Assigned Recee';
  const base = task.installation_type ? INSTALLATION_TYPE_LABELS[task.installation_type] : TASK_TYPES.installation;
  return unassigned ? `Unassigned ${base}` : base;
}

export type TaskType = keyof typeof TASK_TYPES;
