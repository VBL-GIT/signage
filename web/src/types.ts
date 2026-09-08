export type UserRole = 'rjcorp_admin' | 'rjcorp_user' | 'vendor_admin' | 'vendor_user' | 'employee';
export type TaskType = 'recee' | 'installation';
export type InstallationType = 'post_recee' | 'direct' | 'direct_boarding';
export type TaskStatus = 'pending' | 'recee_submitted' | 'recee_approved' | 'recee_rejected' | 'installed' | 'completed';
export type SignageType = 'nonlit' | 'glow_sign_board' | 'impact';

export const ROLE_LABELS: Record<UserRole, string> = {
  rjcorp_admin: 'RJCorp Admin',
  rjcorp_user: 'RJCorp User',
  vendor_admin: 'Vendor Admin',
  vendor_user: 'Vendor User',
  employee: 'Employee',
};

export const SIGNAGE_TYPE_LABELS: Record<SignageType, string> = {
  nonlit: 'Nonlit',
  glow_sign_board: 'Glow Sign Board',
  impact: 'Impact',
};

export const SIGNAGE_TYPES: SignageType[] = ['nonlit', 'glow_sign_board', 'impact'];

export type Privilege =
  | 'task.create' | 'task.assign' | 'task.approve'
  | 'store.manage' | 'artwork.manage' | 'vendor.manage' | 'vendor.status'
  | 'user.manage' | 'user.status' | 'role.manage';

export interface PrivilegeDef { key: Privilege; label: string; }
export interface Role { id: string; name: string; privileges: Privilege[]; created_at: string; }

export interface User {
  id: string; name: string; email: string; role: UserRole; vendor_id: string | null;
  uid?: string | null; first_name?: string | null; last_name?: string | null;
  phone?: string | null;
  is_active?: boolean;
  privileges?: Privilege[];
  custom_role_id?: string | null; custom_role_name?: string | null;
}

export interface Vendor {
  id: string; uid: string; code: number | null; name: string;
  contact_person: string | null; contact_phone: string | null; contact_email: string | null;
  remarks: string | null;
  is_active: boolean;
}
export interface Brand { id: string; name: string; created_at?: string; }
export interface BoardingSize { id: string; label: string; width_cm: number; height_cm: number; }
export interface Artwork {
  id: string; uid: string; brand_id: string; brand_name?: string; name: string;
  image_url: string | null; is_active: boolean; created_at?: string;
}
export interface Store {
  id: string; name: string; address: string; pincode: string; lat: number; long: number;
  uid: string | null; contact_no: string | null; contact_email: string | null; contact_person: string | null;
  /** Business key for create-vs-update on import. Null on stores predating it. */
  customer_code: string | null;
  /** e.g. "ACTIVE", from the customer master. Display only — drives no behaviour. */
  outlet_status: string | null;
  /** HOS / State_CD / CHANNEL / SUB_CHANNEL and any other source columns. */
  source_metadata: Record<string, unknown> | null;
  // Retained: stores keep their vendor mapping, the creation form just no
  // longer asks for it, so newly created stores start with vendor_id null.
  vendor_id: string | null; vendor_name?: string | null;
}

export interface TaskStepPhoto {
  id: string; photo_url: string;
  marker_x: number | null; marker_y: number | null; annotation: string | null;
  lat: number | null; long: number | null;
  signage_type: SignageType | null;
  boarding_size_id: string | null; boarding_size_label: string | null;
  custom_width_cm: number | null; custom_height_cm: number | null;
  brand_id: string | null; brand_name: string | null;
  area_label: string | null;
  distance_from_store_m: number | null; distance_from_first_m: number | null; distance_from_recee_m: number | null;
  signage_index: number | null;
}

export interface TaskStep {
  id: string; step_type: string; performed_by_name: string; timestamp: string;
  lat: number | null; long: number | null; notes: string | null;
  photos: TaskStepPhoto[];
  approval_status: string | null; rejection_reason: string | null; pamphlet_count: number | null;
}

export interface SignagePlanItem {
  signage_index: number; signage_type: SignageType | null;
  boarding_size_id: string | null; boarding_size_label: string | null;
  custom_width_cm: number | null; custom_height_cm: number | null;
  brand_id: string | null; brand_name: string | null;
  artwork_id: string | null; artwork_name: string | null; artwork_image_url: string | null;
  recee_photo_url: string | null; recee_annotation: string | null;
  recee_marker_x: number | null; recee_marker_y: number | null;
  recee_lat: number | null; recee_long: number | null;
}

export interface Task {
  id: string; task_type: TaskType; installation_type: InstallationType | null;
  parent_task_id: string | null; status: TaskStatus;
  store_id: string | null; store_name: string | null; store_address: string | null;
  store_lat: number | null; store_long: number | null; store_uid: string | null;
  store_pincode: string | null; store_contact_no: string | null;
  store_contact_email: string | null; store_contact_person: string | null;
  vendor_id: string | null; vendor_name: string | null; vendor_uid?: string | null;
  employee_id: string | null; employee_name: string | null;
  brand_id: string | null; brand_name: string | null;
  boarding_size_label: string | null; target_pamphlet_count: number | null; pincode: string | null;
  created_at: string; updated_at: string;
  completed_at?: string | null; assigned_at?: string | null; assignment_count?: number | null;
  steps?: TaskStep[];
  signage_plan?: SignagePlanItem[];
  // Present only on a recee's detail response (head office only): its spawned
  // post-recee installation task, so it can be assigned/tracked inline. Vendors
  // see the installation as its own separate task instead.
  post_recee_task?: Task | null;
}

// A single task-step photo, flattened with its task/store context, for the
// head-office Images browser (GET /api/images).
export interface TaskImage {
  id: string;
  photo_url: string;
  captured_at: string;
  task_id: string;
  task_type: TaskType;
  installation_type: InstallationType | null;
  store_uid: string | null;
  store_name: string | null;
  pincode: string | null;
  vendor_name: string | null;
  employee_name: string | null;
  area_label: string | null;
  brand_label: string | null;
  signage_type: SignageType | null;
  boarding_size_label: string | null;
}
