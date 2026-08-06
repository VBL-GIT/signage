import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import api from './api';

export async function presignUpload(filename: string, contentType: string): Promise<{
  upload_url: string;
  public_url: string;
  token: string;
  key: string;
}> {
  const { data } = await api.post('/api/uploads/presign', { filename, content_type: contentType });
  return data;
}

// Web: fetch the (blob:) URL and PUT the resulting browser Blob.
async function uploadViaFetchBlob(uploadUrl: string, fileUri: string, contentType: string): Promise<void> {
  const fileResp = await fetch(fileUri);
  const blob = await fileResp.blob();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!uploadResponse.ok) throw new Error(`Upload failed: ${uploadResponse.status}`);
}

// Native fallback that bypasses expo-file-system entirely. In Expo Go, document-picker
// files are unreadable by expo-file-system, and fetch().blob() can't build a blob from
// an in-JS ArrayBuffer. XMLHttpRequest with responseType 'blob' reads the file:// URI
// using React Native's NATIVE blob support, which we can then PUT directly.
function uploadViaXhrBlob(uploadUrl: string, fileUri: string, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const readXhr = new XMLHttpRequest();
    readXhr.open('GET', fileUri, true);
    readXhr.responseType = 'blob';
    readXhr.onerror = () => reject(new Error('Could not read the selected file'));
    readXhr.onload = () => {
      // file:// reads report status 0 on success
      if (readXhr.status !== 0 && (readXhr.status < 200 || readXhr.status >= 300)) {
        reject(new Error(`Could not read file (status ${readXhr.status})`));
        return;
      }
      const blob = readXhr.response;
      const putXhr = new XMLHttpRequest();
      putXhr.open('PUT', uploadUrl, true);
      putXhr.setRequestHeader('Content-Type', contentType);
      putXhr.onerror = () => reject(new Error('Upload network error'));
      putXhr.onload = () => {
        if (putXhr.status >= 200 && putXhr.status < 300) resolve();
        else reject(new Error(`Upload failed: ${putXhr.status} ${putXhr.responseText}`));
      };
      putXhr.send(blob);
    };
    readXhr.send();
  });
}

export async function uploadToStorage(uploadUrl: string, fileUri: string, contentType: string): Promise<void> {
  if (Platform.OS === 'web') {
    await uploadViaFetchBlob(uploadUrl, fileUri, contentType);
    return;
  }

  // Native (Android/iOS): expo-file-system reads camera files reliably and streams
  // them efficiently, so try it first.
  try {
    const uploadResponse = await FileSystem.uploadAsync(uploadUrl, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    });
    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
      throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.body}`);
    }
  } catch (e) {
    // Fall back to the native XHR blob path (e.g. document-picker files in Expo Go
    // that expo-file-system refuses to read).
    console.warn('[upload] uploadAsync failed, retrying via XHR blob:', (e as Error)?.message);
    await uploadViaXhrBlob(uploadUrl, fileUri, contentType);
  }
}
