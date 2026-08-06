import { useEffect, useMemo, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { getTasks, downloadTasksReport } from '../api';
import type { Task } from '../types';
import { useAuth } from '../store/auth';
import { TaskBadge, Spinner } from '../components/ui';
import { DownloadReportButton } from '../components/DownloadReportButton';
import { Pager } from '../components/Pager';
import { taskAge, dayLabel } from '../lib/taskAge';

const PAGE_SIZE = 20;

const TYPE_LABEL: Record<string, string> = {
  recee: 'Recee',
  post_recee: 'Installation (from recee)',
  direct: 'Direct Installation',
  direct_boarding: 'Installation w/o Recee',
};
function label(t: Task) {
  if (t.task_type === 'installation' && t.installation_type) return TYPE_LABEL[t.installation_type] ?? 'Installation';
  return TYPE_LABEL[t.task_type] ?? t.task_type;
}

type TypeGroup = 'recee' | 'boarding' | 'direct';
function typeGroupOf(t: Task): TypeGroup {
  if (t.task_type === 'recee') return 'recee';
  if (t.installation_type === 'direct') return 'direct';
  return 'boarding'; // post_recee + direct_boarding
}
type TypeFilter = 'all' | TypeGroup;

interface ReportFilter { stage: string; type: string }

export function Tasks() {
  const navigate = useNavigate();
  const role = useAuth().user?.role;
  const isRjcorp = role === 'rjcorp_admin' || role === 'rjcorp_user';
  const [tasks, setTasks] = useState<Task[] | null>(null);
  // Tracks whichever tab + type sub-tab is currently selected below, so the
  // download button always exports exactly what's on screen.
  const [filter, setFilter] = useState<ReportFilter>({ stage: 'all', type: 'all' });

  useEffect(() => { getTasks().then(setTasks).catch(() => setTasks([])); }, []);

  if (!tasks) return <Spinner />;

  const filenamePrefix = ['tasks-report', filter.stage !== 'all' ? filter.stage : null, filter.type !== 'all' ? filter.type : null]
    .filter(Boolean).join('-');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1>Tasks</h1>
        <DownloadReportButton label="Download report" filenamePrefix={filenamePrefix} fetcher={() => downloadTasksReport(filter)} />
      </div>
      {isRjcorp
        ? <JobsView tasks={tasks} navigate={navigate} onFilterChange={setFilter} />
        : <FlatView tasks={tasks} navigate={navigate} onFilterChange={setFilter} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RJCorp (head office): a recee and its spawned installation are shown as ONE
// job with a Recee → Approval → Install lifecycle, so the two-record split isn't
// visible. Standalone installs (direct / boarding) are single-step jobs.
// ---------------------------------------------------------------------------
interface Job { key: string; recee: Task; install: Task | null; standalone: Task | null; }
type JobStage = 'unassigned' | 'in_progress' | 'completed';

function buildJobs(tasks: Task[]): Job[] {
  const childByParent = new Map<string, Task>();
  for (const t of tasks) {
    if (t.installation_type === 'post_recee' && t.parent_task_id) childByParent.set(t.parent_task_id, t);
  }
  const attached = new Set<string>();
  const jobs: Job[] = [];
  for (const t of tasks) {
    if (t.installation_type === 'post_recee') continue; // folded into its recee below
    if (t.task_type === 'recee') {
      const install = childByParent.get(t.id) ?? null;
      if (install) attached.add(install.id);
      jobs.push({ key: t.id, recee: t, install, standalone: null });
    } else {
      jobs.push({ key: t.id, recee: null as unknown as Task, install: null, standalone: t });
    }
  }
  // Safety: a post_recee whose parent recee isn't in the list still gets shown.
  for (const t of tasks) {
    if (t.installation_type === 'post_recee' && !attached.has(t.id)) {
      jobs.push({ key: t.id, recee: null as unknown as Task, install: null, standalone: t });
    }
  }
  return jobs;
}

function activeTask(job: Job): Task { return job.standalone ?? job.install ?? job.recee; }

function jobStage(job: Job): JobStage {
  if (job.standalone) {
    if (job.standalone.status === 'completed') return 'completed';
    return job.standalone.employee_id ? 'in_progress' : 'unassigned';
  }
  if (job.install) {
    if (job.install.status === 'completed') return 'completed';
    return job.install.employee_id ? 'in_progress' : 'unassigned';
  }
  // recee phase, not yet approved
  if (job.recee.status === 'recee_submitted') return 'in_progress'; // awaiting approval
  return job.recee.employee_id ? 'in_progress' : 'unassigned';
}

type JobTab = 'all' | JobStage;

function Stepper({ recee, install }: { recee: Task; install: Task | null }) {
  const receeDone = recee.status === 'recee_submitted' || recee.status === 'recee_approved';
  const rejected = recee.status === 'recee_rejected';
  const approvalDone = recee.status === 'recee_approved';
  const installDone = install?.status === 'completed';
  const steps: { label: string; state: 'done' | 'active' | 'todo' | 'error' }[] = [
    { label: 'Recee', state: receeDone ? 'done' : rejected ? 'error' : 'active' },
    { label: 'Approval', state: approvalDone ? 'done' : recee.status === 'recee_submitted' ? 'active' : 'todo' },
    { label: 'Install', state: installDone ? 'done' : install ? 'active' : 'todo' },
  ];
  const color = (s: string) => s === 'done' ? 'var(--success)' : s === 'active' ? 'var(--brand)' : s === 'error' ? 'var(--danger)' : 'var(--muted)';
  const icon = (s: string) => s === 'done' ? '✓' : s === 'error' ? '✕' : s === 'active' ? '●' : '○';
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 5 }}>
      {steps.map((s, i) => (
        <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: color(s.state), fontWeight: 600, fontSize: 12.5 }}>
            <span>{icon(s.state)}</span>{s.label}
          </span>
          {i < steps.length - 1 && <span className="muted" style={{ fontSize: 12 }}>›</span>}
        </span>
      ))}
    </div>
  );
}

const STAGE_LABEL: Record<JobStage, string> = { unassigned: 'Unassigned', in_progress: 'In Progress', completed: 'Completed' };

function JobsView({ tasks, navigate, onFilterChange }: { tasks: Task[]; navigate: NavigateFunction; onFilterChange: (f: ReportFilter) => void }) {
  const [tab, setTab] = useState<JobTab>('all');
  const [typeTab, setTypeTab] = useState<TypeFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => { onFilterChange({ stage: tab, type: typeTab }); }, [tab, typeTab, onFilterChange]);
  useEffect(() => { setPage(1); }, [tab, typeTab]);

  const jobs = useMemo(() => buildJobs(tasks), [tasks]);

  const counts = useMemo(() => {
    const c = { all: jobs.length, unassigned: 0, in_progress: 0, completed: 0 };
    for (const j of jobs) c[jobStage(j)]++;
    return c;
  }, [jobs]);

  // Status tab applied first; type counts are computed WITHIN that status
  // subset, so the type sub-tab reflects "of the tasks in this status tab,
  // how many are each type" rather than a global count.
  const byStage = useMemo(
    () => jobs.filter((j) => tab === 'all' ? true : jobStage(j) === tab),
    [jobs, tab]
  );
  const typeCounts = useMemo(() => {
    const c = { all: byStage.length, recee: 0, boarding: 0, direct: 0 };
    for (const j of byStage) c[typeGroupOf(j.standalone ?? j.recee)]++;
    return c;
  }, [byStage]);

  const filtered = useMemo(() => {
    return byStage
      .filter((j) => typeTab === 'all' ? true : typeGroupOf(j.standalone ?? j.recee) === typeTab)
      .sort((a, b) => new Date(activeTask(b).created_at).getTime() - new Date(activeTask(a).created_at).getTime());
  }, [byStage, typeTab]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  const tabs: { key: JobTab; label: string }[] = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'unassigned', label: `Needs assignment (${counts.unassigned})` },
    { key: 'in_progress', label: `In progress (${counts.in_progress})` },
    { key: 'completed', label: `Completed (${counts.completed})` },
  ];
  const typeTabs: { key: TypeFilter; label: string }[] = [
    { key: 'all', label: `All (${typeCounts.all})` },
    { key: 'recee', label: `Recee jobs (${typeCounts.recee})` },
    { key: 'boarding', label: `Installation w/o Recee (${typeCounts.boarding})` },
    { key: 'direct', label: `Direct Installation (${typeCounts.direct})` },
  ];

  return (
    <div>
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => { setTab(t.key); setTypeTab('all'); }}>{t.label}</div>
        ))}
      </div>
      <div className="tabs" style={{ border: 'none', marginBottom: 12 }}>
        {typeTabs.map((t) => (
          <div key={t.key} className={`chip ${typeTab === t.key ? 'on' : ''}`} onClick={() => setTypeTab(t.key)}>{t.label}</div>
        ))}
      </div>

      {filtered.length === 0 && <p className="meta">No tasks in this view.</p>}
      {filtered.length > 0 && (
        <div className="meta" style={{ marginBottom: 12 }}>
          {filtered.length} job{filtered.length === 1 ? '' : 's'} · page {page} of {totalPages}
        </div>
      )}
      <div className="row-list">
        {shown.map((job) => {
          // Standalone install / pamphlet — single-step row.
          if (job.standalone) {
            const t = job.standalone;
            const age = taskAge(t);
            return (
              <div key={job.key} className="list-row" onClick={() => navigate(`/tasks/${t.id}`)}>
                <div>
                  <div style={{ fontWeight: 700 }}>{label(t)}</div>
                  <div className="meta">{t.store_name ?? 'No store'}{t.vendor_name ? ` · ${t.vendor_name}` : ''}{t.employee_name ? ` · ${t.employee_name}` : ' · unassigned'}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{new Date(t.created_at).toLocaleDateString()}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <TaskBadge task={t} />
                  <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {age.completedInDays != null ? `completed in ${dayLabel(age.completedInDays)}` : `${dayLabel(age.ageDays)} old`}
                  </span>
                </div>
              </div>
            );
          }
          // Recee job — combined Recee → Approval → Install lifecycle. Click opens
          // the recee detail, which shows the installation inline.
          const { recee, install } = job;
          const stage = jobStage(job);
          const latest = install ?? recee;
          const age = taskAge(latest);
          return (
            <div key={job.key} className="list-row" onClick={() => navigate(`/tasks/${recee.id}`)} style={{ alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700 }}>Recee + Installation</div>
                <div className="meta">
                  {recee.store_name ?? 'No store'}
                  {recee.vendor_name ? ` · ${recee.vendor_name}` : ''}
                </div>
                <div className="meta">
                  Recee: {recee.employee_name ?? 'unassigned'}
                  {install ? ` · Install: ${install.employee_name ?? 'unassigned'}` : ''}
                </div>
                <Stepper recee={recee} install={install} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className={`badge ${stage}`}>{STAGE_LABEL[stage]}</span>
                <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {age.completedInDays != null ? `done in ${dayLabel(age.completedInDays)}` : `${dayLabel(age.ageDays)} old`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vendor staff: flat list, scoped by the backend to their own vendor. Each task
// (recee, installation) is shown on its own — vendors act on individual tasks.
// ---------------------------------------------------------------------------
type FlatTab = 'all' | 'unassigned' | 'in_progress' | 'recee_submitted' | 'recee_approved' | 'recee_rejected' | 'installed' | 'completed';
// Status-only matcher (type is applied separately now that the type sub-tabs
// show under every status tab). Tabs overlap by design — e.g. an assigned
// recee_submitted task matches both "In Progress" and "Recee Submitted".
function matchesFlatStatus(t: Task, tab: FlatTab): boolean {
  switch (tab) {
    case 'all': return true;
    case 'unassigned': return !t.employee_id;
    case 'in_progress': return !!t.employee_id && t.status !== 'completed';
    case 'recee_submitted': return t.status === 'recee_submitted';
    case 'recee_approved': return t.status === 'recee_approved';
    case 'recee_rejected': return t.status === 'recee_rejected';
    case 'installed': return t.status === 'installed';
    case 'completed': return t.status === 'completed';
  }
}
type Sort = 'newest' | 'oldest';

function FlatView({ tasks, navigate, onFilterChange }: { tasks: Task[]; navigate: NavigateFunction; onFilterChange: (f: ReportFilter) => void }) {
  const [tab, setTab] = useState<FlatTab>('all');
  const [typeTab, setTypeTab] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(1);

  useEffect(() => { onFilterChange({ stage: tab, type: typeTab }); }, [tab, typeTab, onFilterChange]);
  useEffect(() => { setPage(1); }, [tab, typeTab, sort]);

  // Status-tab counts are computed over every task (independent of the type
  // sub-tab), so switching type never changes the status badges.
  const counts = useMemo(() => {
    const c = { all: 0, unassigned: 0, in_progress: 0, recee_submitted: 0, recee_approved: 0, recee_rejected: 0, installed: 0, completed: 0 };
    tasks.forEach((t) => {
      c.all++;
      if (!t.employee_id) c.unassigned++;
      if (t.employee_id && t.status !== 'completed') c.in_progress++;
      if (t.status === 'recee_submitted') c.recee_submitted++;
      if (t.status === 'recee_approved') c.recee_approved++;
      if (t.status === 'recee_rejected') c.recee_rejected++;
      if (t.status === 'installed') c.installed++;
      if (t.status === 'completed') c.completed++;
    });
    return c;
  }, [tasks]);

  // Status tab applied first; type counts are computed WITHIN that subset so the
  // type sub-tab reflects "of the tasks in this status tab, how many are each
  // type" — same behaviour as the RJCorp Jobs view.
  const byStatus = useMemo(() => tasks.filter((t) => matchesFlatStatus(t, tab)), [tasks, tab]);
  const typeCounts = useMemo(() => {
    const c = { all: byStatus.length, recee: 0, boarding: 0, direct: 0 };
    for (const t of byStatus) c[typeGroupOf(t)]++;
    return c;
  }, [byStatus]);

  const filtered = useMemo(() => {
    const list = byStatus.filter((t) => typeTab === 'all' ? true : typeGroupOf(t) === typeTab);
    return [...list].sort((a, b) => {
      const da = new Date(a.created_at).getTime(), db = new Date(b.created_at).getTime();
      return tab === 'all' && sort === 'oldest' ? da - db : db - da;
    });
  }, [byStatus, typeTab, tab, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  const tabs: { key: FlatTab; label: string }[] = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'unassigned', label: `Unassigned (${counts.unassigned})` },
    { key: 'in_progress', label: `In Progress (${counts.in_progress})` },
    { key: 'recee_submitted', label: `Recee Submitted (${counts.recee_submitted})` },
    { key: 'recee_approved', label: `Recee Approved (${counts.recee_approved})` },
    { key: 'recee_rejected', label: `Recee Rejected (${counts.recee_rejected})` },
    { key: 'installed', label: `Installed (${counts.installed})` },
    { key: 'completed', label: `Completed (${counts.completed})` },
  ];
  const typeTabs: { key: TypeFilter; label: string }[] = [
    { key: 'all', label: `All (${typeCounts.all})` },
    { key: 'recee', label: `Recee (${typeCounts.recee})` },
    { key: 'boarding', label: `Installation w/o Recee (${typeCounts.boarding})` },
    { key: 'direct', label: `Direct Installation (${typeCounts.direct})` },
  ];

  return (
    <div>
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => { setTab(t.key); setTypeTab('all'); }}>{t.label}</div>
        ))}
      </div>

      <div className="tabs" style={{ border: 'none', marginBottom: 12 }}>
        {typeTabs.map((t) => (
          <div key={t.key} className={`chip ${typeTab === t.key ? 'on' : ''}`} onClick={() => setTypeTab(t.key)}>{t.label}</div>
        ))}
      </div>

      {tab === 'all' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span className="meta">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 'auto' }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      )}

      {filtered.length === 0 && <p className="meta">No tasks in this view.</p>}
      {filtered.length > 0 && (
        <div className="meta" style={{ marginBottom: 12 }}>
          {filtered.length} task{filtered.length === 1 ? '' : 's'} · page {page} of {totalPages}
        </div>
      )}
      <div className="row-list">
        {shown.map((t) => {
          const age = taskAge(t);
          return (
            <div key={t.id} className="list-row" onClick={() => navigate(`/tasks/${t.id}`)}>
              <div>
                <div style={{ fontWeight: 700 }}>{label(t)}</div>
                <div className="meta">
                  {t.store_name ?? 'No store'}
                  {t.vendor_name ? ` · ${t.vendor_name}` : ''}
                  {t.employee_name ? ` · ${t.employee_name}` : ' · unassigned'}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {new Date(t.created_at).toLocaleDateString()}
                  {age.reassigned && age.daysSinceReassignment != null && ` · reassigned ${dayLabel(age.daysSinceReassignment)} ago`}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <TaskBadge task={t} />
                <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {age.completedInDays != null ? `completed in ${dayLabel(age.completedInDays)}` : `${dayLabel(age.ageDays)} old`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <Pager page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
