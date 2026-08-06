import { useState } from 'react';
import { presignUpload, uploadToStorage } from '../services/uploads.api';

export function useUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(fileUri: string): Promise<string | null> {
    setUploading(true);
    setError(null);
    try {
      const filename = `photo_${Date.now()}.jpg`;
      console.log('[upload] fileUri:', fileUri);
      const { upload_url, public_url } = await presignUpload(filename, 'image/jpeg');
      console.log('[upload] presign ok, upload_url:', upload_url);
      await uploadToStorage(upload_url, fileUri, 'image/jpeg');
      console.log('[upload] storage upload ok');
      return public_url;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[upload] FAILED:', msg);
      setError(msg);
      return null;
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, error };
}
