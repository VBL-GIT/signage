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
  post_recee: 'Installation (from recee)',
  direct: 'Direct Installation',
  direct_boarding: 'Installation w/o Recee',
};

export function taskTypeLabel(task: Task): string {
  if (task.task_type === 'installation' && task.installation_type) {
    return INSTALLATION_TYPE_LABELS[task.installation_type];
  }
  return TASK_TYPES[task.task_type];
}

export type TaskType = keyof typeof TASK_TYPES;
