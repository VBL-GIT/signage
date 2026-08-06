export type UserRole =
  | 'rjcorp_admin'
  | 'rjcorp_user'
  | 'vendor_admin'
  | 'vendor_user'
  | 'employee';

export const ROLE_LABELS: Record<UserRole, string> = {
  rjcorp_admin: 'RJCorp Admin',
  rjcorp_user: 'RJCorp User',
  vendor_admin: 'Vendor Admin',
  vendor_user: 'Vendor User',
  employee: 'Employee',
};

export type TaskType = 'recee' | 'installation';

export type InstallationType = 'post_recee' | 'direct' | 'direct_boarding';

export type TaskStatus =
  | 'pending'
  | 'recee_submitted'
  | 'recee_approved'
  | 'recee_rejected'
  | 'installed'
  | 'completed';

export interface User {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  role: UserRole;
  vendor_id?: string | null;
}

export interface Vendor {
  id: string;
  uid: string;
  name: string;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BulkResult {
  inserted: number;
  failed: { row: number; reason: string }[];
}

export interface Store {
  id: string;
  name: string;
  address: string;
  pincode: string;
  lat: number;
  long: number;
  uid: string | null;
  contact_no: string | null;
  contact_email: string | null;
  contact_person: string | null;
}

export interface Brand {
  id: string;
  name: string;
}

export interface BoardingSize {
  id: string;
  label: string;
  width_cm: number;
  height_cm: number;
}

export type SignageType = 'nonlit' | 'glow_sign_board' | 'impact';

export interface TaskStepPhoto {
  id: string;
  photo_url: string;
  marker_x: number | null;
  marker_y: number | null;
  annotation: string | null;
  // Per-signage fields (Sprint 5): each photo represents one signage.
  lat: number | null;
  long: number | null;
  signage_type: SignageType | null;
  boarding_size_id: string | null;
  boarding_size_label: string | null;
  custom_width_cm: number | null;
  custom_height_cm: number | null;
  brand_id: string | null;
  brand_name: string | null;
  area_label: string | null;
  distance_from_store_m: number | null;
  distance_from_first_m: number | null;
  distance_from_recee_m: number | null;
  signage_index: number | null;
}

// One predetermined signage to install (from the task's plan).
export interface SignagePlanItem {
  signage_index: number;
  signage_type: SignageType | null;
  boarding_size_id: string | null;
  boarding_size_label: string | null;
  custom_width_cm: number | null;
  custom_height_cm: number | null;
  brand_id: string | null;
  brand_name: string | null;
  artwork_id: string | null;
  artwork_name: string | null;
  artwork_image_url: string | null;
  recee_photo_url: string | null;
  recee_annotation: string | null;
  recee_marker_x: number | null;
  recee_marker_y: number | null;
  recee_lat: number | null;
  recee_long: number | null;
}

export interface TaskStep {
  id: string;
  step_type: string;
  performed_by: string;
  performed_by_name: string;
  lat: number | null;
  long: number | null;
  timestamp: string;
  photo_url: string | null;
  photos: TaskStepPhoto[];
  notes: string | null;
  boarding_size_id: string | null;
  boarding_size_label: string | null;
  custom_width_cm: number | null;
  custom_height_cm: number | null;
  approval_status: string | null;
  rejection_reason: string | null;
  pamphlet_count: number | null;
}

export interface Task {
  id: string;
  task_type: TaskType;
  installation_type: InstallationType | null;
  parent_task_id: string | null;
  status: TaskStatus;
  store_id: string | null;
  store_name: string | null;
  store_address: string | null;
  store_lat: number | null;
  store_long: number | null;
  store_uid: string | null;
  store_contact_no: string | null;
  store_pincode: string | null;
  store_contact_email: string | null;
  store_contact_person: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
  supervisor_id: string | null;
  supervisor_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  boarding_size_id: string | null;
  boarding_size_label: string | null;
  custom_width_cm: number | null;
  custom_height_cm: number | null;
  target_pamphlet_count: number | null;
  pincode: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  assigned_at?: string | null;
  assignment_count?: number | null;
  steps?: TaskStep[];
  signage_plan?: SignagePlanItem[];
}
