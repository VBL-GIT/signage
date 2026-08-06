import { supabase } from '../config/storage';
import { env } from '../config/env';

export async function generatePresignedUploadUrl(filename: string, contentType: string) {
  const key = `${Date.now()}-${filename}`;
  const { data, error } = await supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUploadUrl(key);

  if (error || !data) {
    throw new Error(`Failed to generate upload URL: ${error?.message}`);
  }

  const publicUrl = supabase.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .getPublicUrl(key).data.publicUrl;

  return {
    upload_url: data.signedUrl,
    token: data.token,
    public_url: publicUrl,
    key,
  };
}
