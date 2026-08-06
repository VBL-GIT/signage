import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';

export function useCamera() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  async function takePicture(): Promise<string | null> {
    if (!cameraRef.current) return null;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: false });
    if (!photo) return null;
    setPhotoUri(photo.uri);
    return photo.uri;
  }

  function clearPhoto() {
    setPhotoUri(null);
  }

  return { permission, requestPermission, cameraRef, photoUri, takePicture, clearPhoto };
}
