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
  brand_label?: string;
}

export type InstallationPayload =
  | { notes?: string; pincode?: string; photos: PamphletPhotoPayload[] }
  | { notes?: string; signages: InstallSignagePayload[] };

export async function submitInstallation(taskId: string, body: InstallationPayload): Promise<Task> {
  const { data } = await api.post(`/api/tasks/${taskId}/install`, body);
  return data;
}

