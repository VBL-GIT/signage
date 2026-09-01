import { Response } from 'express';
import * as XLSX from 'xlsx';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { isHeadOffice } from '../auth/privileges';

const cmToIn = (cm: number | null) => (cm ? Math.round(cm / 2.54) : null);

const SIGNAGE_TYPE_LABELS: Record<string, string> = {
  nonlit: 'Nonlit',
  glow_sign_board: 'Glow Sign Board',
  impact: 'Impact',
};
const humanizeSignageTypes = (agg: string | null) =>
  agg ? agg.split(',').map((s) => SIGNAGE_TYPE_LABELS[s.trim()] ?? s.trim()).join(', ') : '';

const DAY_MS = 86_400_000;
/** Whole days between two instants (>= 0). Returns '' when either side is missing. */
function daysBetween(from: string | Date | null, to: string | Date | null): number | '' {
  if (!from || !to) return '';
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS));
}

// CSV has no concept of a hyperlink or sheet name — cell values are plain text
// only, so a multi-URL cell (e.g. "Image URLs") just shows every URL as
// unlinked text (still newline-separated within the quoted field, which Excel/
// Sheets render as a wrapped multi-line cell same as before).
function sendWorkbook(res: Response, rows: Record<string, unknown>[], _sheetName: string, filenamePrefix: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}-${date}.csv"`);
  // BOM so Excel opens UTF-8 CSVs without mangling non-ASCII characters.
  res.send('﻿' + csv);
}

/** Detailed tasks report — one row per task, scoped the same as the tasks list. */
export async function exportTasksReport(req: AuthRequest, res: Response) {
  const user = req.user!;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!isHeadOffice(user.role)) {
    conditions.push(`t.vendor_id = $${params.length + 1}`);
    params.push(user.vendor_id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT t.id, t.task_type, t.installation_type, t.status, t.parent_task_id, t.employee_id,
            v.uid as vendor_uid, v.name as vendor_name,
            s.uid as store_uid, s.name as store_name, s.address as store_address, s.pincode as store_pincode,
            e.uid as employee_uid, e.name as employee_name,
            b.name as brand_name, aw.name as artwork_name, aw.uid as artwork_uid,
            sbs.label as boarding_size_label, t.custom_width_cm, t.custom_height_cm,
            t.target_pamphlet_count, t.pincode as task_pincode,
            t.completed_at, t.assigned_at, t.assignment_count,
            plan.signage_types, plan.brands as plan_brands, plan.artworks as plan_artworks,
            plan.artwork_uids as plan_artwork_uids, plan.sizes as plan_sizes,
            recee_capture.signage_types as recee_signage_types, recee_capture.sizes as recee_sizes,
            (SELECT COUNT(*) FROM task_signage_plan p WHERE p.task_id = t.id) as planned_signages,
            (SELECT COUNT(*) FROM task_steps ts JOIN task_step_photos tsp ON tsp.task_step_id = ts.id WHERE ts.task_id = t.id) as photos_submitted,
            -- Joined with " | " (not a newline) so the cell stays a single line and
            -- never wraps by default when opened in Excel/Sheets.
            (SELECT string_agg(tsp.photo_url, ' | ' ORDER BY tsp.signage_index NULLS LAST, tsp.created_at)
               FROM task_steps ts JOIN task_step_photos tsp ON tsp.task_step_id = ts.id WHERE ts.task_id = t.id) as image_urls,
            (SELECT MAX(ts2.timestamp) FROM task_steps ts2 WHERE ts2.task_id = t.id) as last_activity_at,
            t.created_at, t.updated_at
     FROM tasks t
     LEFT JOIN vendors v ON v.id = t.vendor_id
     LEFT JOIN stores s ON s.id = t.store_id
     LEFT JOIN users e ON e.id = t.employee_id
     LEFT JOIN brands b ON b.id = t.brand_id
     LEFT JOIN artworks aw ON aw.id = t.artwork_id
     LEFT JOIN standard_boarding_sizes sbs ON sbs.id = t.boarding_size_id
     -- Per-signage plan (post_recee installs store brand/artwork/size here only,
     -- not on the task row itself; direct_boarding has both, so this is a fallback).
     LEFT JOIN LATERAL (
       SELECT
         string_agg(DISTINCT p.signage_type::text, ', ') FILTER (WHERE p.signage_type IS NOT NULL) as signage_types,
         string_agg(DISTINCT pb.name, ', ') FILTER (WHERE pb.name IS NOT NULL) as brands,
         string_agg(DISTINCT pa.name, ', ') FILTER (WHERE pa.name IS NOT NULL) as artworks,
         string_agg(DISTINCT pa.uid, ', ') FILTER (WHERE pa.uid IS NOT NULL) as artwork_uids,
         string_agg(DISTINCT COALESCE(psz.label,
           CASE WHEN p.custom_width_cm IS NOT NULL AND p.custom_height_cm IS NOT NULL
                THEN round(p.custom_width_cm / 2.54) || 'x' || round(p.custom_height_cm / 2.54) || ' in (custom)'
           END), ', ') FILTER (WHERE psz.label IS NOT NULL OR p.custom_width_cm IS NOT NULL) as sizes
       FROM task_signage_plan p
       LEFT JOIN brands pb ON pb.id = p.brand_id
       LEFT JOIN artworks pa ON pa.id = p.artwork_id
       LEFT JOIN standard_boarding_sizes psz ON psz.id = p.boarding_size_id
       WHERE p.task_id = t.id
     ) plan ON true
     -- A raw recee task has no task_signage_plan row (that's only created on
     -- approval) — its captured signage type/size lives on the recee step's
     -- own photos instead, so fall back to those for recee-type tasks.
     LEFT JOIN LATERAL (
       SELECT
         string_agg(DISTINCT tsp.signage_type::text, ', ') FILTER (WHERE tsp.signage_type IS NOT NULL) as signage_types,
         string_agg(DISTINCT COALESCE(rsz.label,
           CASE WHEN tsp.custom_width_cm IS NOT NULL AND tsp.custom_height_cm IS NOT NULL
                THEN round(tsp.custom_width_cm / 2.54) || 'x' || round(tsp.custom_height_cm / 2.54) || ' in (custom)'
           END), ', ') FILTER (WHERE rsz.label IS NOT NULL OR tsp.custom_width_cm IS NOT NULL) as sizes
       FROM task_steps ts
       JOIN task_step_photos tsp ON tsp.task_step_id = ts.id
       LEFT JOIN standard_boarding_sizes rsz ON rsz.id = tsp.boarding_size_id
       WHERE ts.task_id = t.id AND ts.step_type = 'recee'
     ) recee_capture ON true
     ${where}
     ORDER BY t.created_at DESC`,
    params
  );

  // ---- Optional stage/type filters, matching exactly what the Tasks page shows
  // for the current tab + type sub-tab, so "download report" always exports the
  // same set of tasks that's on screen.
  const stageParam = String(req.query.stage ?? 'all');
  const typeParam = String(req.query.type ?? 'all');

  let filtered = rows;
  if (isHeadOffice(user.role)) {
    // Head office sees a job = recee + its spawned post_recee install folded
    // together (see Tasks.tsx JobsView). A job's stage/type is driven by the
    // install (or the standalone task) when one exists, otherwise by the recee.
    const installByParent = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (r.installation_type === 'post_recee' && r.parent_task_id) installByParent.set(r.parent_task_id, r);
    const attachedInstallIds = new Set(Array.from(installByParent.values()).map((r) => r.id));

    function jobStageFor(row: (typeof rows)[number]): 'unassigned' | 'in_progress' | 'completed' {
      const isStandalone = row.task_type === 'installation' && row.installation_type !== 'post_recee';
      const isInstall = row.installation_type === 'post_recee';
      if (isStandalone || isInstall) {
        return row.status === 'completed' ? 'completed' : (row.employee_id ? 'in_progress' : 'unassigned');
      }
      // row is a recee — its spawned install (if any) drives the stage instead.
      const install = installByParent.get(row.id);
      if (install) return install.status === 'completed' ? 'completed' : (install.employee_id ? 'in_progress' : 'unassigned');
      if (row.status === 'recee_submitted') return 'in_progress';
      return row.employee_id ? 'in_progress' : 'unassigned';
    }
    function jobTypeFor(row: (typeof rows)[number]): 'recee' | 'boarding' | 'direct' {
      if (row.task_type === 'recee') return 'recee';
      // An attached post_recee install is folded under its recee's "Recee jobs" type.
      if (row.installation_type === 'post_recee') return attachedInstallIds.has(row.id) ? 'recee' : 'boarding';
      if (row.installation_type === 'direct') return 'direct';
      return 'boarding'; // direct_boarding
    }

    filtered = rows.filter((r) =>
      (stageParam === 'all' || jobStageFor(r) === stageParam) &&
      (typeParam === 'all' || jobTypeFor(r) === typeParam)
    );
  } else {
    // Vendor staff see a flat, per-task list (Tasks.tsx FlatView). Its tabs
    // overlap by design (e.g. an assigned recee_submitted task matches both
    // "In Progress" and "Recee Submitted") — mirror matchesFlatStatus exactly
    // rather than treating stage as a strict partition. The type sub-tab shows
    // under every status tab now, so the type filter applies on every stage.
    function flatType(row: (typeof rows)[number]): 'recee' | 'boarding' | 'direct' {
      if (row.task_type === 'recee') return 'recee';
      if (row.installation_type === 'direct') return 'direct';
      return 'boarding';
    }
    function matchesStage(row: (typeof rows)[number]): boolean {
      switch (stageParam) {
        case 'unassigned': return !row.employee_id;
        case 'in_progress': return !!row.employee_id && row.status !== 'completed';
        case 'recee_submitted': return row.status === 'recee_submitted';
        case 'recee_approved': return row.status === 'recee_approved';
        case 'recee_rejected': return row.status === 'recee_rejected';
        case 'installed': return row.status === 'installed';
        case 'completed': return row.status === 'completed';
        default: return true; // 'all'
      }
    }
    filtered = rows.filter((r) =>
      matchesStage(r) &&
      (typeParam === 'all' || flatType(r) === typeParam)
    );
  }

  const now = new Date();
  const report = filtered.map((r) => {
    const reassigned = Number(r.assignment_count ?? 0) >= 2;
    return {
    'Task ID': r.id,
    'Type': r.task_type,
    'Installation Type': r.installation_type ?? '',
    'Status': r.status,
    'Vendor UID': r.vendor_uid ?? '',
    'Vendor': r.vendor_name ?? '',
    'Store UID': r.store_uid ?? '',
    'Store': r.store_name ?? '',
    'Store Address': r.store_address ?? '',
    'Store Pincode': r.store_pincode ?? '',
    'Employee UID': r.employee_uid ?? '',
    'Employee': r.employee_name ?? 'Unassigned',
    'Board Type': humanizeSignageTypes((r.signage_types ?? r.recee_signage_types) as string | null),
    'Brand': r.brand_name ?? r.plan_brands ?? '',
    'Artwork UID': r.artwork_uid ?? r.plan_artwork_uids ?? '',
    'Artwork': r.artwork_name ?? r.plan_artworks ?? '',
    'Board Size': r.boarding_size_label
      ?? (r.custom_width_cm && r.custom_height_cm ? `${cmToIn(r.custom_width_cm as number)}x${cmToIn(r.custom_height_cm as number)} in (custom)` : null)
      ?? r.plan_sizes ?? r.recee_sizes ?? '',
    'Target Pamphlet Count': r.target_pamphlet_count ?? '',
    'Task Pincode': r.task_pincode ?? '',
    'Planned Signages': r.planned_signages ?? 0,
    'Photos Submitted': r.photos_submitted ?? 0,
    'Image URLs': r.image_urls ?? '',
    'Age (days)': daysBetween(r.created_at as string, now),
    'Completed In (days)': r.completed_at ? daysBetween(r.created_at as string, r.completed_at as string) : '',
    'Times Reassigned': reassigned ? Number(r.assignment_count) - 1 : 0,
    'Days Since Reassignment': reassigned && r.assigned_at ? daysBetween(r.assigned_at as string, now) : '',
    'Completed At': r.completed_at ? new Date(r.completed_at as string).toLocaleString() : '',
    'Last Activity': r.last_activity_at ? new Date(r.last_activity_at as string).toLocaleString() : '',
    'Created': new Date(r.created_at as string).toLocaleString(),
    'Updated': new Date(r.updated_at as string).toLocaleString(),
  };
  });

  // When the report is scoped to one task type, every row shares the same shape —
  // so drop the columns that type never uses (they'd just be a blank column).
  // "all" (mixed types) keeps the full original superset, unchanged, since rows
  // are heterogeneous — pinned explicitly so it can't silently pick up columns
  // added to the row-mapping above for a single type (like Image URLs).
  const ALL_COLUMNS = [
    'Task ID', 'Type', 'Installation Type', 'Status', 'Vendor UID', 'Vendor', 'Store UID', 'Store', 'Store Address', 'Store Pincode',
    'Employee UID', 'Employee', 'Board Type', 'Brand', 'Artwork UID', 'Artwork', 'Board Size', 'Target Pamphlet Count', 'Task Pincode',
    'Planned Signages', 'Photos Submitted', 'Age (days)', 'Completed In (days)', 'Times Reassigned', 'Days Since Reassignment',
    'Completed At', 'Last Activity', 'Created', 'Updated',
  ];
  const COLUMNS_BY_TYPE: Record<string, string[]> = {
    recee: [
      'Task ID', 'Status', 'Vendor UID', 'Vendor', 'Store UID', 'Store', 'Store Address', 'Store Pincode',
      'Employee UID', 'Employee', 'Board Type', 'Board Size', 'Photos Submitted', 'Image URLs',
      'Age (days)', 'Times Reassigned', 'Days Since Reassignment', 'Last Activity', 'Created', 'Updated',
    ],
    // Covers both post_recee and direct_boarding ("Installation w/o Recee").
    boarding: [
      'Task ID', 'Installation Type', 'Status', 'Vendor UID', 'Vendor', 'Store UID', 'Store', 'Store Address', 'Store Pincode',
      'Employee UID', 'Employee', 'Board Type', 'Brand', 'Artwork UID', 'Artwork', 'Board Size', 'Planned Signages', 'Photos Submitted', 'Image URLs',
      'Age (days)', 'Completed In (days)', 'Times Reassigned', 'Days Since Reassignment', 'Completed At', 'Last Activity', 'Created', 'Updated',
    ],
    direct: [
      'Task ID', 'Status', 'Vendor UID', 'Vendor', 'Store UID', 'Store', 'Store Address', 'Store Pincode',
      'Employee UID', 'Employee', 'Target Pamphlet Count', 'Task Pincode', 'Photos Submitted',
      'Age (days)', 'Completed In (days)', 'Times Reassigned', 'Days Since Reassignment', 'Completed At', 'Last Activity', 'Created', 'Updated',
    ],
  };
  const columns = COLUMNS_BY_TYPE[typeParam] ?? ALL_COLUMNS;
  const trimmed = report.map((row) => Object.fromEntries(columns.map((c) => [c, (row as Record<string, unknown>)[c]])));

  const prefix = ['tasks-report', stageParam !== 'all' ? stageParam : null, typeParam !== 'all' ? typeParam : null]
    .filter(Boolean).join('-');
  sendWorkbook(res, trimmed, 'Tasks', prefix);
}

/** Approvals report — every recee approval/rejection decision, scoped by vendor. */
export async function exportApprovalsReport(req: AuthRequest, res: Response) {
  const user = req.user!;
  const conditions: string[] = [`ts.step_type = 'approval'`];
  const params: unknown[] = [];
  if (!isHeadOffice(user.role)) {
    conditions.push(`t.vendor_id = $${params.length + 1}`);
    params.push(user.vendor_id);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await pool.query(
    `SELECT ts.id as approval_id, ts.timestamp, ts.approval_status, ts.rejection_reason,
            approver.name as approved_by,
            t.id as task_id, v.uid as vendor_uid, v.name as vendor_name,
            s.uid as store_uid, s.name as store_name,
            emp.name as recee_employee_name,
            (SELECT COUNT(*) FROM task_signage_plan p JOIN tasks child ON child.id = p.task_id WHERE child.parent_task_id = t.id) as accepted_signages
     FROM task_steps ts
     JOIN tasks t ON t.id = ts.task_id
     LEFT JOIN vendors v ON v.id = t.vendor_id
     LEFT JOIN stores s ON s.id = t.store_id
     LEFT JOIN users approver ON approver.id = ts.performed_by
     LEFT JOIN users emp ON emp.id = t.employee_id
     ${where}
     ORDER BY ts.timestamp DESC`,
    params
  );

  const report = rows.map((r) => ({
    'Task ID': r.task_id,
    'Decision': r.approval_status,
    'Vendor UID': r.vendor_uid ?? '',
    'Vendor': r.vendor_name ?? '',
    'Store UID': r.store_uid ?? '',
    'Store': r.store_name ?? '',
    'Recee Employee': r.recee_employee_name ?? '',
    'Accepted Signages': r.approval_status === 'approved' ? (r.accepted_signages ?? 0) : 0,
    'Rejection Reason': r.rejection_reason ?? '',
    'Decided By': r.approved_by ?? '',
    'Decided At': new Date(r.timestamp as string).toLocaleString(),
  }));

  sendWorkbook(res, report, 'Approvals', 'approvals-report');
}

/** Stores report, scoped by vendor. */
export async function exportStoresReport(req: AuthRequest, res: Response) {
  const user = req.user!;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!isHeadOffice(user.role)) {
    conditions.push(`s.vendor_id = $${params.length + 1}`);
    params.push(user.vendor_id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT s.uid, s.customer_code, s.outlet_status, s.name, s.address, s.pincode, s.lat, s.long,
            s.contact_person, s.contact_no, s.contact_email,
            v.uid as vendor_uid, v.name as vendor_name,
            (SELECT COUNT(*) FROM tasks tk WHERE tk.store_id = s.id) as total_tasks,
            (SELECT COUNT(*) FROM tasks tk WHERE tk.store_id = s.id AND tk.status = 'completed') as completed_tasks,
            s.created_at
     FROM stores s
     LEFT JOIN vendors v ON v.id = s.vendor_id
     ${where}
     ORDER BY s.name`,
    params
  );

  const report = rows.map((r) => ({
    'Customer Code': r.customer_code ?? '',
    'Store UID': r.uid ?? '',
    'Store Name': r.name,
    'Address': r.address,
    'Pincode': r.pincode,
    'Latitude': r.lat,
    'Longitude': r.long,
    'Contact Person': r.contact_person ?? '',
    'Contact No': r.contact_no ?? '',
    'Contact Email': r.contact_email ?? '',
    'Outlet Status': r.outlet_status ?? '',
    'Vendor UID': r.vendor_uid ?? '',
    'Vendor': r.vendor_name ?? 'Unmapped',
    'Total Tasks': r.total_tasks ?? 0,
    'Completed Tasks': r.completed_tasks ?? 0,
    'Created': r.created_at ? new Date(r.created_at as string).toLocaleString() : '',
  }));

  sendWorkbook(res, report, 'Stores', 'stores-report');
}

/** Vendors report (Manage > Vendors) — head office only, so no vendor scoping needed. */
export async function exportVendorsReport(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query(
    `SELECT v.uid, v.name, v.contact_person, v.contact_phone, v.contact_email, v.is_active, v.created_at,
            (SELECT COUNT(*) FROM stores s WHERE s.vendor_id = v.id) as total_stores,
            (SELECT COUNT(*) FROM users u WHERE u.vendor_id = v.id AND u.role = 'employee') as total_employees
     FROM vendors v
     ORDER BY v.name`
  );

  const report = rows.map((r) => ({
    'Vendor UID': r.uid ?? '',
    'Name': r.name,
    'Contact Person': r.contact_person ?? '',
    'Contact Phone': r.contact_phone ?? '',
    'Contact Email': r.contact_email ?? '',
    'Status': r.is_active ? 'Active' : 'Inactive',
    'Total Stores': r.total_stores ?? 0,
    'Total Employees': r.total_employees ?? 0,
    'Created': r.created_at ? new Date(r.created_at as string).toLocaleString() : '',
  }));

  sendWorkbook(res, report, 'Vendors', 'vendors-report');
}

/** Employees report (Manage > Employees), scoped by vendor like the list endpoint. */
export async function exportEmployeesReport(req: AuthRequest, res: Response) {
  const user = req.user!;
  const conditions: string[] = [`u.role = 'employee'`];
  const params: unknown[] = [];
  if (!isHeadOffice(user.role)) {
    conditions.push(`u.vendor_id = $${params.length + 1}`);
    params.push(user.vendor_id);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await pool.query(
    `SELECT u.uid, u.name, u.email, u.phone, u.is_active, u.created_at,
            v.uid as vendor_uid, v.name as vendor_name,
            (SELECT COUNT(*) FROM tasks tk WHERE tk.employee_id = u.id) as total_tasks,
            (SELECT COUNT(*) FROM tasks tk WHERE tk.employee_id = u.id AND tk.status = 'completed') as completed_tasks
     FROM users u
     LEFT JOIN vendors v ON v.id = u.vendor_id
     ${where}
     ORDER BY u.name`,
    params
  );

  const report = rows.map((r) => ({
    'Employee UID': r.uid ?? '',
    'Name': r.name,
    'Email': r.email,
    'Phone': r.phone ?? '',
    'Vendor UID': r.vendor_uid ?? '',
    'Vendor': r.vendor_name ?? '',
    'Status': r.is_active ? 'Active' : 'Inactive',
    'Total Tasks': r.total_tasks ?? 0,
    'Completed Tasks': r.completed_tasks ?? 0,
    'Created': r.created_at ? new Date(r.created_at as string).toLocaleString() : '',
  }));

  sendWorkbook(res, report, 'Employees', 'employees-report');
}

/** Brands report (Manage > Brands) — plain reference list, no vendor scoping. */
export async function exportBrandsReport(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query(
    `SELECT b.name, b.created_at,
            (SELECT COUNT(*) FROM artworks a WHERE a.brand_id = b.id) as total_artworks
     FROM brands b
     ORDER BY b.name`
  );

  const report = rows.map((r) => ({
    'Brand Name': r.name,
    'Total Artworks': r.total_artworks ?? 0,
    'Created': r.created_at ? new Date(r.created_at as string).toLocaleString() : '',
  }));

  sendWorkbook(res, report, 'Brands', 'brands-report');
}

/** Artworks report (Manage > Artworks) — plain reference list, no vendor scoping. */
export async function exportArtworksReport(_req: AuthRequest, res: Response) {
  const { rows } = await pool.query(
    `SELECT a.uid, a.name, a.is_active, a.created_at, b.name as brand_name
     FROM artworks a
     JOIN brands b ON b.id = a.brand_id
     ORDER BY b.name, a.name`
  );

  const report = rows.map((r) => ({
    'Artwork UID': r.uid ?? '',
    'Artwork Name': r.name,
    'Brand': r.brand_name,
    'Status': r.is_active ? 'Active' : 'Inactive',
    'Created': r.created_at ? new Date(r.created_at as string).toLocaleString() : '',
  }));

  sendWorkbook(res, report, 'Artworks', 'artworks-report');
}
