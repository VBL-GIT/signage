import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getTask } from '../api';
import type { Task } from '../types';
import { useHasPrivilege } from '../store/auth';
import { TaskBadge, Button, Card, Spinner } from '../components/ui';
import { AnnotatedImage } from '../components/AnnotatedImage';
import { useLightbox } from '../components/Lightbox';
import { formatDistance } from '../lib/distance';
import { customSizeLabel } from '../lib/units';
import { taskAge, dayLabel } from '../lib/taskAge';
import { SIGNAGE_TYPE_LABELS } from '../types';

const TYPE_LABEL: Record<string, string> = {
  recee: 'Recee', post_recee: 'Installation (from recee)',
  direct: 'Direct Installation', direct_boarding: 'Installation w/o Recee',
};

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const has = useHasPrivilege();
  const { open: zoom } = useLightbox();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (id) getTask(id).then(setTask).finally(() => setLoading(false)); }, [id]);

  if (loading) return <Spinner />;
  if (!task) return <p>Task not found.</p>;

  const label = task.task_type === 'installation' && task.installation_type
    ? TYPE_LABEL[task.installation_type] : TYPE_LABEL[task.task_type];
  const canApprove = has('task.approve');
  const canAssign = has('task.assign') && (
    (task.task_type === 'recee' && (task.status === 'pending' || task.status === 'recee_rejected')) ||
    (task.task_type === 'installation' && task.status === 'pending')
  );
  const mapsUrl = task.store_lat != null && task.store_long != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${task.store_lat},${task.store_long}` : null;
  const age = taskAge(task);

  return (
    <div>
      <Link to="/tasks" className="meta">← Tasks</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 16px', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{label}</h1>
        <TaskBadge task={task} />
        <span className="muted" style={{ fontSize: 14 }}>
          {age.completedInDays != null ? `completed in ${dayLabel(age.completedInDays)}` : `${dayLabel(age.ageDays)} old`}
        </span>
      </div>

      <div className="grid2">
        <Card>
          <h3>Store</h3>
          <div style={{ fontWeight: 700 }}>{task.store_name ?? '—'}</div>
          <div className="meta">{task.store_address}</div>
          {task.store_pincode && <div className="meta">Pincode: {task.store_pincode}</div>}
          {task.store_uid && <div className="meta">Store UID: {task.store_uid}</div>}
          {task.brand_name && <div className="meta">Brand: {task.brand_name}</div>}
          {task.vendor_name && <div className="meta">Vendor: {task.vendor_name}</div>}
          <div className="meta">Employee: {task.employee_name ?? 'unassigned'}</div>
        </Card>

        <Card>
          <h3>Store Contact</h3>
          {task.store_contact_person && <div className="meta">👤 {task.store_contact_person}</div>}
          {task.store_contact_no && <div className="meta">📞 <a href={`tel:${task.store_contact_no}`}>{task.store_contact_no}</a></div>}
          {task.store_contact_email && <div className="meta">✉️ <a href={`mailto:${task.store_contact_email}`}>{task.store_contact_email}</a></div>}
          {!task.store_contact_person && !task.store_contact_no && !task.store_contact_email && <div className="muted">No contact on file</div>}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm" style={{ marginTop: 10 }}>🗺️ Open directions in Google Maps</Button>
            </a>
          )}
        </Card>
      </div>

      <Card>
        <h3>Task age</h3>
        <div className="meta">Created: {new Date(task.created_at).toLocaleString()}</div>
        {age.completedInDays != null ? (
          <>
            <div className="meta">Completed in: <b>{dayLabel(age.completedInDays)}</b>{task.completed_at ? ` (${new Date(task.completed_at).toLocaleDateString()})` : ''}</div>
            <div className="meta">Record age: {dayLabel(age.ageDays)}</div>
          </>
        ) : (
          <div className="meta">Age: <b>{dayLabel(age.ageDays)}</b> since created</div>
        )}
        {age.reassigned && (
          <div className="meta">
            Reassigned {age.timesReassigned}× · last {age.daysSinceReassignment != null ? `${dayLabel(age.daysSinceReassignment)} ago` : 'recently'}
            {task.assigned_at ? ` (${new Date(task.assigned_at).toLocaleDateString()})` : ''}
          </div>
        )}
      </Card>

      {/* Post-recee installation: assign + track the spawned install task inline,
          so there's no separate task to hunt down after approving the recee. */}
      {task.task_type === 'recee' && task.post_recee_task && (() => {
        const child = task.post_recee_task!;
        const cAge = taskAge(child);
        const canAssignChild = has('task.assign') && child.status === 'pending';
        const installPhotos = (child.steps ?? [])
          .filter((s) => s.step_type === 'installation')
          .flatMap((s) => s.photos);
        return (
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Installation (from this recee)</h3>
              <TaskBadge task={child} />
              <span className="muted" style={{ fontSize: 13 }}>
                {cAge.completedInDays != null ? `completed in ${dayLabel(cAge.completedInDays)}` : `${dayLabel(cAge.ageDays)} old`}
              </span>
            </div>
            <p className="meta" style={{ marginTop: 6 }}>Created automatically when this recee was approved.</p>
            <div className="meta">Employee: <b>{child.employee_name ?? 'Unassigned'}</b>{child.assignment_count ? ` · reassigned ${child.assignment_count}×` : ''}</div>
            {!!child.signage_plan?.length && <div className="meta">{child.signage_plan.length} signage(s) to install</div>}

            {installPhotos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                {installPhotos.map((p) => (
                  <div key={p.id} style={{ width: 96, textAlign: 'center' }}>
                    <AnnotatedImage uri={p.photo_url} annotation={p.annotation} markerX={p.marker_x} markerY={p.marker_y} size={96} />
                    {p.signage_index != null && <div className="meta" style={{ fontSize: 10 }}>Signage {p.signage_index}</div>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              {canAssignChild && (
                <Button onClick={() => navigate(`/tasks/${child.id}/assign?back=/tasks/${task.id}`)}>
                  {child.employee_id ? 'Reassign Employee' : 'Assign to Employee'}
                </Button>
              )}
              <Button variant="secondary" onClick={() => navigate(`/tasks/${child.id}`)}>Open full installation →</Button>
            </div>
          </Card>
        );
      })()}

      {/* Planned signages for installation tasks */}
      {!!task.signage_plan?.length && (
        <Card>
          <h3>Signage plan ({task.signage_plan.length})</h3>
          <div className="row-list">
            {task.signage_plan.map((p) => (
              <div key={p.signage_index} className="list-row" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 14 }}>
                  {(p.recee_photo_url || p.artwork_image_url) && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {p.recee_photo_url && (
                        <div style={{ textAlign: 'center' }}>
                          <AnnotatedImage uri={p.recee_photo_url} annotation={p.recee_annotation} markerX={p.recee_marker_x} markerY={p.recee_marker_y} size={120} />
                          <div className="meta" style={{ fontSize: 10 }}>Recee</div>
                        </div>
                      )}
                      {p.artwork_image_url && (
                        <div style={{ textAlign: 'center' }}>
                          <img
                            src={p.artwork_image_url}
                            alt="artwork"
                            onClick={() => zoom({ uri: p.artwork_image_url!, alt: 'artwork' })}
                            style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'zoom-in' }}
                          />
                          <div className="meta" style={{ fontSize: 10 }}>Artwork</div>
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <div style={{ fontWeight: 700 }}>Signage {p.signage_index}{p.signage_type ? ` · ${SIGNAGE_TYPE_LABELS[p.signage_type]}` : ''}</div>
                    <div className="meta">
                      Size: {p.boarding_size_label ?? (customSizeLabel(p.custom_width_cm, p.custom_height_cm) ?? '—')}
                      {' · '}Brand: {p.brand_name ?? '—'}
                      {p.artwork_name ? ` · Artwork: ${p.artwork_name}` : ''}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Timeline */}
      {!!task.steps?.length && (
        <Card>
          <h3>Timeline</h3>
          {task.steps.map((step) => (
            <div key={step.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--brand)' }}>{step.step_type.replace(/_/g, ' ').toUpperCase()}</div>
              <div className="meta">{step.performed_by_name} · {new Date(step.timestamp).toLocaleString()}</div>
              {step.approval_status && (
                <div className="meta" style={{ color: step.approval_status === 'approved' ? 'var(--success)' : 'var(--danger)' }}>
                  {step.approval_status === 'approved' ? 'Approved' : `Rejected: ${step.rejection_reason}`}
                </div>
              )}
              {step.pamphlet_count != null && <div className="meta">Pamphlets: {step.pamphlet_count}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
                {step.photos.map((p) => (
                  <div key={p.id} style={{ width: 130 }}>
                    <AnnotatedImage uri={p.photo_url} annotation={p.annotation} markerX={p.marker_x} markerY={p.marker_y} />
                    {p.signage_index != null && <div style={{ fontWeight: 700, fontSize: 12, marginTop: 4 }}>Signage {p.signage_index}</div>}
                    {p.signage_type && <div className="meta">{SIGNAGE_TYPE_LABELS[p.signage_type]}</div>}
                    {(p.boarding_size_label || (p.custom_width_cm && p.custom_height_cm)) && (
                      <div className="meta">{p.boarding_size_label ?? customSizeLabel(p.custom_width_cm, p.custom_height_cm)}</div>
                    )}
                    {p.area_label && <div className="meta">🏬 {p.area_label}</div>}
                    {p.brand_name && <div className="meta">{p.brand_name}</div>}
                    {p.lat != null && p.long != null && p.distance_from_store_m == null && (
                      <div className="dist">📍 {Number(p.lat).toFixed(5)}, {Number(p.long).toFixed(5)}</div>
                    )}
                    {p.distance_from_store_m != null && <div className="dist">📍 {formatDistance(p.distance_from_store_m)} from store</div>}
                    {p.distance_from_recee_m != null && <div className="dist">📍 {formatDistance(p.distance_from_recee_m)} from 1st recee</div>}
                    {p.distance_from_first_m != null && <div className="dist">📍 {formatDistance(p.distance_from_first_m)} from #1</div>}
                  </div>
                ))}
              </div>
              {step.notes && <div className="meta" style={{ fontStyle: 'italic', marginTop: 6 }}>{step.notes}</div>}
            </div>
          ))}
        </Card>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        {canApprove && task.status === 'recee_submitted' && (
          <Button onClick={() => navigate(`/tasks/${task.id}/approve`)}>Review Recee</Button>
        )}
        {canAssign && (
          <Button onClick={() => navigate(`/tasks/${task.id}/assign`)}>
            {task.employee_id ? 'Reassign Employee' : 'Assign to Employee'}
          </Button>
        )}
      </div>
    </div>
  );
}
