import api from './api';
import { User } from '../types/domain';

export async function login(email: string, password: string): Promise<{
  access_token: string;
  refresh_token: string;
  user: User;
}> {
  const { data } = await api.post('/api/auth/login', { email, password });
  return data;
}

export async function logout(refreshToken: string) {
  await api.post('/api/auth/logout', { refresh_token: refreshToken });
}

/** Files a forgot-password request for an administrator (users cannot change their own password). */
export async function forgotPassword(email: string, name?: string, mobile?: string): Promise<{ message: string }> {
  const { data } = await api.post('/api/auth/forgot-password', { email, name: name || undefined, mobile: mobile || undefined });
  return data;
}
