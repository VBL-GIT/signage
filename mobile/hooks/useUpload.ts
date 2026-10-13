import { useRef, useState } from 'react';
import { presignUpload, uploadToStorage } from '../services/uploads.api';
import { getUploadedUrl, rememberUpload } from '../utils/drafts';

const ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useUpload() {
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  function bump(d: number) { counter.current += d; setInFlight(counter.current); }

  /**
   * Uploads one photo; returns its public URL, or null if it could not be uploaded.
   * Reuses the URL of a photo that already uploaded (e.g. before a failed submit)
   * and retries transient failures with backoff, which is what makes a weak
   * connection survivable.
   */
  async function upload(fileUri: string): Promise<string | null> {
    const cached = await getUploadedUrl(fileUri);
    if (cached) return cached;
    bump(1);
    setError(null);
    try {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
          const filename = `photo_${Date.now()}.jpg`;
          const { upload_url, public_url } = await presignUpload(filename, 'image/jpeg');
          await uploadToStorage(upload_url, fileUri, 'image/jpeg');
          await rememberUpload(fileUri, public_url);
          return public_url;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[upload] attempt ${attempt + 1}/${ATTEMPTS} failed:`, msg);
          setError(msg);
          if (attempt < ATTEMPTS - 1) await sleep(800 * 2 ** attempt);
        }
      }
      return null;
    } finally {
      bump(-1);
    }
  }

  /** Uploads several photos with limited concurrency; result order matches input, null = failed. */
  async function uploadAll(uris: string[], concurrency = 3): Promise<(string | null)[]> {
    const results: (string | null)[] = new Array(uris.length).fill(null);
    let next = 0;
    async function worker() {
      while (next < uris.length) {
        const i = next++;
        results[i] = await upload(uris[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, uris.length) }, worker));
    return results;
  }

  return { upload, uploadAll, uploading: inFlight > 0, error };
}
