export type UserRole =
  | 'rjcorp_admin'
  | 'rjcorp_user'
  | 'vendor_admin'
  | 'vendor_user'
  | 'employee';

// Roles allowed to perform onboarding / management actions
export const ADMIN_ROLES: UserRole[] = ['rjcorp_admin', 'vendor_admin'];

export type TaskType = 'recee' | 'installation';

export type InstallationType = 'post_recee' | 'direct';

export type TaskStatus =
  | 'pending'
  | 'recee_submitted'
  | 'recee_approved'
  | 'recee_rejected'
  | 'installed'
  | 'completed';

export type StepType =
  | 'recee'
  | 'approval'
  | 'installation';

export type ApprovalStatus = 'approved' | 'rejected';

export type SignageType = 'nonlit' | 'glow_sign_board' | 'impact';

export interface User {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: UserRole;
  vendor_id: string | null;
  uid: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface Vendor {
  id: string;
  uid: string;
  code: number | null;
  name: string;
  contact_person: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface Store {
  id: string;
  name: string;
  address: string;
  pincode: string;
  lat: number;
  long: number;
  vendor_id: string | null;
  uid: string | null;
  contact_no: string | null;
  contact_email: string | null;
  contact_person: string | null;
}

export interface Brand {
  id: string;
  name: string;
  vendor_id: string | null;
}

export interface StandardBoardingSize {
  id: string;
  label: string;
  width_cm: number;
  height_cm: number;
}

export interface Task {
  id: string;
  task_type: TaskType;
  installation_type: InstallationType | null;
  parent_task_id: string | null;
  status: TaskStatus;
  store_id: string | null;
  vendor_id: string | null;
  employee_id: string | null;
  supervisor_id: string | null;
  brand_id: string | null;
  boarding_size_id: string | null;
  custom_width_cm: number | null;
  custom_height_cm: number | null;
  target_pamphlet_count: number | null;
  pincode: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TaskStepPhoto {
  id: string;
  task_step_id: string;
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
  distance_from_store_m: number | null;
  distance_from_first_m: number | null;
  distance_from_recee_m: number | null;
  signage_index: number | null;
}

export interface TaskStep {
  id: string;
  task_id: string;
  step_type: StepType;
  performed_by: string;
  lat: number | null;
  long: number | null;
  timestamp: Date;
  photo_url: string | null;
  photos: TaskStepPhoto[];
  notes: string | null;
  boarding_size_id: string | null;
  custom_width_cm: number | null;
  custom_height_cm: number | null;
  approval_status: ApprovalStatus | null;
  rejection_reason: string | null;
  pamphlet_count: number | null;
}
