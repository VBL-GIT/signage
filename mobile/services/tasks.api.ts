import api from './api';
import { Task, SignageType } from '../types/domain';

export async function getTasks(params?: { status?: string; type?: string; store_id?: string }): Promise<Task[]> {
  const { data } = await api.get('/api/tasks', { params });
  return data;
}

export async function getTask(id: string): Promise<Task> {
  const { data } = await api.get(`/api/tasks/${id}`);
  return data;
}

/**
 * After a failed submit: did the server actually get it? A response lost on a weak
 * connection looks like a failure, and re-sending would be rejected (the status
 * already moved on), so the employee would be stuck. Treat a task that has
 * reached one of `statuses` as submitted.
 */
export async function taskReached(taskId: string, statuses: string[]): Promise<boolean> {
  try { return statuses.includes((await getTask(taskId)).status); } catch { return false; }
}

export interface ReceeSignagePayload {
  photo_url: string;
  lat: number;
  long: number;
  signage_type: SignageType;
  boarding_size_id?: string;
  custom_width_cm?: number;
  custom_height_cm?: number;
  distance_from_store_m?: number;
  distance_from_first_m?: number;
  annotation?: string;
}

export async function submitRecee(taskId: string, body: {
  notes?: string;
  signages: ReceeSignagePayload[];
}): Promise<Task> {
  const { data } = await api.post(`/api/tasks/${taskId}/recee`, body);
  return data;
}

export interface FieldOutletPayload {
  /** First decision for a new outlet. SPEED needs its Customer Code. */
  outlet_type: 'speed' | 'non_speed';
  customer_code?: string;
  name: string;
  /** Address 1 (required) and Address 2, as in the store template. */
  ADDR_1: string;
  ADDR_2?: string;
  pincode: string;
  lat: number;
  long: number;
  contact_person?: string;
  contact_no?: string;
  contact_email?: string;
  CHANNEL?: string;
  SUB_CHANNEL?: string;
  STATE_CD?: string;
}

/** Recee of an outlet nobody assigned: an existing store_id OR a new outlet. */
export async function submitFieldRecee(body: {
  store_id?: string;
  outlet?: FieldOutletPayload;
  brand_id?: string;
  allow_duplicate?: boolean;
  /** Same value on every retry of one submission, so a lost response never creates a second outlet/task. */
  client_request_id?: string;
  notes?: string;
  signages: ReceeSignagePayload[];
}): Promise<{ task_id: string; store_id: string; store_created: boolean }> {
  const { data } = await api.post('/api/tasks/field-recee', body);
  return data;
}

/**
 * Installation of an outlet nobody assigned, with no recee. The employee supplies
 * the brand/artwork and each signage's type + size along with the photos; the
 * task is created already completed.
 */
export async function submitFieldInstall(body: {
  store_id?: string;
  outlet?: FieldOutletPayload;
  brand_id: string;
  artwork_id?: string;
  allow_duplicate?: boolean;
  client_request_id?: string;
  notes?: string;
  signages: ReceeSignagePayload[];
}): Promise<{ task_id: string; store_id: string; store_created: boolean }> {
  const { data } = await api.post('/api/tasks/field-install', body);
  return data;
}

export interface InstallSignagePayload {
  signage_index: number;
  photo_url: string;
  lat: number;
  long: number;
  distance_from_store_m?: number;
  distance_from_first_m?: number;
  distance_from_recee_m?: number;
}

export interface PamphletPhotoPayload {
  photo_url: string;
  lat?: number;
  long?: number;
  area_label?: string;
}

export type InstallationPayload =
  | { notes?: string; pincode: string; photos: PamphletPhotoPayload[] }
  | { notes?: string; signages: InstallSignagePayload[] };

export async function submitInstallation(taskId: string, body: InstallationPayload): Promise<Task> {
  const { data } = await api.post(`/api/tasks/${taskId}/install`, body);
  return data;
}

