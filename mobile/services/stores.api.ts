import api from './api';

export interface NearbyStore {
  id: string;
  name: string;
  address: string;
  pincode: string;
  lat: number;
  long: number;
  is_field_added: boolean;
  distance_m: number | null;
}

export async function getNearbyStores(params: { lat?: number; long?: number; q?: string }): Promise<NearbyStore[]> {
  const { data } = await api.get('/api/stores/nearby', { params });
  return data;
}
