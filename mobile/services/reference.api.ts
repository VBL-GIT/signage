import api from './api';
import { Brand, BoardingSize } from '../types/domain';

export async function getBrands(): Promise<Brand[]> {
  const { data } = await api.get('/api/brands');
  return data;
}

export async function getBoardingSizes(): Promise<BoardingSize[]> {
  const { data } = await api.get('/api/boarding-sizes');
  return data;
}
