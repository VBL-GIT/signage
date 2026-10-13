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

export interface ArtworkOption { id: string; name: string; brand_id: string; image_url: string | null }

export async function getArtworks(brandId: string): Promise<ArtworkOption[]> {
  const { data } = await api.get('/api/artworks', { params: { brand_id: brandId } });
  return data;
}
