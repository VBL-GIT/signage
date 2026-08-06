// Task age / completion / reassignment display math. Mirrors the tasks report
// columns so the web console and the Excel export agree.

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
  ageDays: number;                 // days since the task was created
  completedInDays: number | null;  // created -> completed (only when completed)
  reassigned: boolean;             // assigned 2+ times
  timesReassigned: number;         // assignment_count - 1 (>= 0)
  daysSinceReassignment: number | null; // last (re)assignment -> now, only when reassigned
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
