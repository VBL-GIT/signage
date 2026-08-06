// Task age / completion / reassignment display math. Mirrors the web helper and
// the tasks report so all three agree.

export interface TaskAgeInput {
  created_at: string;
  completed_at?: string | null;
  assigned_at?: string | null;
  assignment_count?: number | null;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: number) =>
  Math.max(0, Math.floor((to - new Date(from).getTime()) / DAY_MS));

export interface TaskAge {
  ageDays: number;
  completedInDays: number | null;
  reassigned: boolean;
  timesReassigned: number;
  daysSinceReassignment: number | null;
}

export function taskAge(t: TaskAgeInput): TaskAge {
  const now = Date.now();
  const count = t.assignment_count ?? 0;
  const reassigned = count >= 2;
  return {
    ageDays: daysBetween(t.created_at, now),
    completedInDays: t.completed_at ? daysBetween(t.created_at, new Date(t.completed_at).getTime()) : null,
    reassigned,
    timesReassigned: Math.max(0, count - 1),
    daysSinceReassignment: reassigned && t.assigned_at ? daysBetween(t.assigned_at, now) : null,
  };
}

export const dayLabel = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
