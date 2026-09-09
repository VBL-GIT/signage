import { api } from './client';
import type {
  Task, Vendor, Store, Brand, BoardingSize, Artwork, User, SignageType, Role, PrivilegeDef, Privilege, TaskImage,
} from '../types';

// ---- auth
export async function login(email: string, password: string) {
  const { data } = await api.post('/api/auth/login', { email, password });
  return data as { access_token: string; refresh_token: string; user: User };
}
export async function logoutApi(refresh_token: string) {
  await api.post('/api/auth/logout', { refresh_token }).catch(() => {});
}
export async function forgotPassword(email: string) {
  const { data } = await api.post('/api/auth/forgot-password', { email });
  return data as { message: string };
}
export async function resetPassword(token: string, password: string) {
  const { data } = await api.post('/api/auth/reset-password', { token, password });
  return data as { message: string };
}

// ---- tasks
export async function getTasks(params?: { status?: string; type?: string; store_id?: string }) {
  const { data } = await api.get('/api/tasks', { params });
  return data as Task[];
}
export async function getTask(id: string) {
  const { data } = await api.get(`/api/tasks/${id}`);
  return data as Task;
}
export async function createTask(body: {
  task_type: 'recee' | 'installation'; vendor_id: string;
  installation_type?: 'direct' | 'direct_boarding'; store_id?: string;
  brand_id?: string; artwork_id?: string; boarding_size_id?: string; custom_width_cm?: number; custom_height_cm?: number;
  signage_type?: SignageType; pincode?: string; target_pamphlet_count?: number;
}) {
  const { data } = await api.post('/api/tasks', body);
  return data as Task;
}
export async function assignTask(taskId: string, employee_id: string) {
  const { data } = await api.post(`/api/tasks/${taskId}/assign`, { employee_id });
  return data as Task;
}
export interface BulkAssignResult { assigned: number; failed: { task_id: string; reason: string }[] }
export async function assignBulk(body: { task_ids: string[]; employee_id: string }) {
  const { data } = await api.post('/api/tasks/assign-bulk', body);
  return data as BulkAssignResult;
}
export interface ApproveSignage {
  signage_index: number; brand_id: string; artwork_id?: string;
  boarding_size_id?: string; custom_width_cm?: number; custom_height_cm?: number;
}
export async function approveRecee(taskId: string, body: {
  approval_status: 'approved' | 'rejected'; rejection_reason?: string; signages?: ApproveSignage[];
}) {
  const { data } = await api.post(`/api/tasks/${taskId}/approve`, body);
  return data as Task;
}
export interface BulkApprovalResult { approved: number; rejected: number; failed: { task_id: string; reason: string }[] }
export async function approveBulk(body: {
  action: 'approve' | 'reject'; task_ids: string[];
  brand_id?: string; artwork_id?: string; rejection_reason?: string;
}) {
  const { data } = await api.post('/api/tasks/approve-bulk', body);
  return data as BulkApprovalResult;
}

// ---- reference / org
export async function getVendors() { const { data } = await api.get('/api/vendors'); return data as Vendor[]; }
export async function createVendor(body: {
  name: string; contact_person?: string; contact_phone?: string; contact_email?: string;
  remarks?: string;
}) {
  const { data } = await api.post('/api/vendors', body); return data as Vendor;
}
export async function setVendorActive(id: string, is_active: boolean) {
  const { data } = await api.patch(`/api/vendors/${id}/status`, { is_active }); return data as Vendor;
}
export async function updateVendor(id: string, body: {
  name?: string; contact_person?: string; contact_phone?: string; contact_email?: string;
}) { const { data } = await api.patch(`/api/vendors/${id}`, body); return data as Vendor; }
export async function setUserActive(id: string, is_active: boolean) {
  const { data } = await api.patch(`/api/users/${id}/status`, { is_active }); return data as User;
}
export async function updateUser(id: string, body: {
  first_name?: string; last_name?: string; email?: string; mobile?: string;
}) { const { data } = await api.patch(`/api/users/${id}`, body); return data as User; }
/** Dev/test cleanup only — hard-deletes an employee account and cascades to their tasks/history. */
export async function deleteEmployee(id: string) { await api.delete(`/api/users/${id}`); }
export async function getStores() { const { data } = await api.get('/api/stores'); return data as Store[]; }
export interface ImagesPage { total: number; images: TaskImage[] }
export async function getImages(params?: {
  from?: string; to?: string; store_uid?: string; pincode?: string;
  hos?: string; employee_uid?: string; limit?: number; offset?: number;
}) {
  const { data } = await api.get('/api/images', { params });
  return data as ImagesPage;
}
export async function getStore(id: string) { const { data } = await api.get(`/api/stores/${id}`); return data as Store; }
export interface StoreWritePayload {
  customer_code: string;
  // No longer collected by any form. Sent only to carry an existing store's
  // legacy uid through an edit unchanged; the server defaults it to the
  // customer code when absent.
  uid?: string;
  name: string; pincode: string; lat: number; long: number;
  contact_no: string; contact_email: string; contact_person: string;
  outlet_status?: string;
  // The address is sent as parts, matching the bulk template; the server joins
  // them. `address` remains accepted for older callers that pre-join it.
  address?: string;
  ADDR_1?: string; ADDR_2?: string; ADDR_3?: string; ADDR_4?: string; ADDR_5?: string;
  // No store column of their own — the server files these into source_metadata,
  // under these all-caps names. The server matches column names on spelling
  // alone, so the casing here only decides how the keys are stored.
  HOS?: string; STATE_CD?: string; CHANNEL?: string; SUB_CHANNEL?: string;
}
/**
 * Create a store, or update the existing one when its Customer Code is already
 * known — the backend decides. `outcome` says which happened.
 */
export async function createStore(body: StoreWritePayload) {
  const { data } = await api.post('/api/stores', body);
  return data as Store & { outcome: 'created' | 'updated' };
}
/**
 * Edit a store. Sending ONLY `vendor_id` is the vendor-mapping operation: the
 * backend applies it directly without re-validating the whole record, so it
 * also works on stores created before Customer Code existed.
 */
export async function updateStore(
  id: string,
  body: Partial<StoreWritePayload> & { vendor_id?: string | null }
) {
  const { data } = await api.patch(`/api/stores/${id}`, body);
  return data as Store & { outcome: 'updated' };
}
export async function getBrands() { const { data } = await api.get('/api/brands'); return data as Brand[]; }
export async function createBrand(name: string) { const { data } = await api.post('/api/brands', { name }); return data as Brand; }
export async function getBoardingSizes() { const { data } = await api.get('/api/boarding-sizes'); return data as BoardingSize[]; }

// ---- artworks (per-brand named designs)
export async function getArtworks(brand_id?: string) {
  const { data } = await api.get('/api/artworks', { params: brand_id ? { brand_id } : undefined });
  return data as Artwork[];
}
export async function createArtwork(body: { brand_id: string; name: string; image_url?: string }) {
  const { data } = await api.post('/api/artworks', body); return data as Artwork;
}
export async function updateArtwork(id: string, body: { name?: string; is_active?: boolean; image_url?: string | null }) {
  const { data } = await api.patch(`/api/artworks/${id}`, body); return data as Artwork;
}
/** Browser image file -> presign -> PUT to storage -> returns the public URL. */
export async function uploadPublicImage(file: File): Promise<string> {
  const safe = `artwork_${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
  const ct = file.type || 'image/jpeg';
  const { upload_url, public_url } = await presignUpload(safe, ct);
  const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': ct }, body: file });
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
  return public_url;
}
export async function getUsers(params?: { role?: string }) {
  const { data } = await api.get('/api/users', { params }); return data as User[];
}
/**
 * Create an account. By design the server generates a temporary password and
 * emails it to the new user; it is never returned here, so `email_sent: false`
 * would normally mean nobody can log in as that user until they use Forgot
 * Password.
 *
 * INTERIM: `password` may be supplied while outbound email is undeliverable —
 * Forgot Password needs email too, so without it a new account is stranded.
 * Omit it and the generate-and-email path runs unchanged. It travels in the
 * request body only and is never echoed back.
 */
export async function createUser(body: {
  first_name: string; last_name: string; email: string;
  role: string; mobile?: string; vendor_id?: string; custom_role_id?: string;
  password?: string;
}) {
  const { data } = await api.post('/api/users', body);
  return data as { user: User; email_sent: boolean; password_set_by_admin?: boolean };
}
export async function setUserRole(id: string, custom_role_id: string | null) {
  const { data } = await api.patch(`/api/users/${id}/role`, { custom_role_id }); return data as User;
}

// ---- custom roles + privileges
export async function getMe() { const { data } = await api.get('/api/auth/me'); return data as { id: string; role: string; privileges: Privilege[] }; }
export async function getRoles() { const { data } = await api.get('/api/roles'); return data as Role[]; }
export async function getPrivilegeCatalog() { const { data } = await api.get('/api/roles/privileges'); return data as PrivilegeDef[]; }
export async function createRole(body: { name: string; privileges: Privilege[] }) {
  const { data } = await api.post('/api/roles', body); return data as Role;
}
export async function updateRole(id: string, body: { name?: string; privileges?: Privilege[] }) {
  const { data } = await api.patch(`/api/roles/${id}`, body); return data as Role;
}

// ---- uploads + bulk
export async function presignUpload(filename: string, content_type: string) {
  const { data } = await api.post('/api/uploads/presign', { filename, content_type });
  return data as { upload_url: string; public_url: string };
}
export type BulkTarget = 'vendors' | 'users' | 'tasks' | 'stores';
// Tasks upload per type: `kind` fixes the task type for the whole file.
export type TaskKind = 'recee' | 'direct' | 'direct_boarding';
// Stores upload in one of two sheet layouts: the compact operational template,
// or VBL's 56-column customer-master export.
export type StoreFormat = 'compact' | 'customer_master';
export interface BulkResult {
  inserted: number;
  /** Rows matched to an existing Customer Code and updated in place (stores). */
  updated?: number;
  emailed?: number;
  /**
   * Addresses whose credentials email could not be delivered (users channel).
   * Their temporary password is unrecoverable — those people must use Forgot
   * Password. Never contains a password.
   */
  email_failed?: string[];
  failed: { row: number; reason: string }[];
}
export async function bulkUpload(
  target: BulkTarget, file_url: string, kind?: TaskKind, format?: StoreFormat
) {
  const body: Record<string, unknown> = { file_url };
  if (kind) body.kind = kind;
  if (format) body.format = format;
  const { data } = await api.post(`/api/bulk/${target}`, body);
  return data as BulkResult;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Browser file -> presign -> PUT to storage -> bulk endpoint. */
export async function uploadBulkFile(
  target: BulkTarget, file: File, kind?: TaskKind, format?: StoreFormat
): Promise<BulkResult> {
  const safe = `bulk_${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
  const { upload_url, public_url } = await presignUpload(safe, XLSX_MIME);
  const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': XLSX_MIME }, body: file });
  if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
  return bulkUpload(target, public_url, kind, format);
}

// ---- downloadable reports (.csv)
async function downloadReport(path: string, params?: Record<string, string>): Promise<Blob> {
  try {
    const { data } = await api.get(path, { responseType: 'blob', params });
    return data as Blob;
  } catch (e) {
    // With responseType 'blob', error bodies arrive as a Blob too — unwrap the
    // JSON so apiError() can read the backend's actual message.
    const ax = e as { response?: { data?: unknown } };
    if (ax?.response?.data instanceof Blob) {
      try { ax.response.data = JSON.parse(await ax.response.data.text()); } catch { /* leave as-is */ }
    }
    throw ax;
  }
}
// stage/type mirror the current Tasks page tab + type sub-tab, so the exported
// report matches whatever's on screen. Omit both (or pass 'all') for everything.
export const downloadTasksReport = (filters?: { stage?: string; type?: string }) =>
  downloadReport('/api/reports/tasks', filters);
export const downloadApprovalsReport = () => downloadReport('/api/reports/approvals');
export const downloadStoresReport = () => downloadReport('/api/reports/stores');
export const downloadVendorsReport = () => downloadReport('/api/reports/vendors');
export const downloadEmployeesReport = () => downloadReport('/api/reports/employees');
export const downloadBrandsReport = () => downloadReport('/api/reports/brands');
export const downloadArtworksReport = () => downloadReport('/api/reports/artworks');

/**
 * Reveal one account's current password.
 *
 * Authorised for RJCorp admins (any account) and vendor admins (their own
 * vendor's staff only); anyone else gets a 403. `password` is null when none is
 * stored — accounts predating the feature, or created while the server had no
 * encryption key — and `reason` explains which.
 *
 * Deliberately a per-user call rather than a field on getUsers(): a password
 * leaves the server only when someone asks for that specific account.
 */
export async function getUserPassword(id: string) {
  const { data } = await api.get(`/api/users/${id}/password`);
  return data as {
    user_id: string; email: string;
    password: string | null; available: boolean; reason: string | null;
  };
}
