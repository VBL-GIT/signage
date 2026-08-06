import api from './api';
import { User, UserRole } from '../types/domain';

export async function getUsers(params?: { role?: UserRole }): Promise<User[]> {
  const { data } = await api.get('/api/users', { params });
  return data;
}

export async function createUser(body: {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role: UserRole;
  mobile?: string;
  vendor_id?: string;
}): Promise<User> {
  const { data } = await api.post('/api/users', body);
  return data;
}
