import { useState } from 'react';
import { Platform } from 'react-native';

export function useLocation() {
  const [coords, setCoords] = useState<{ lat: number; long: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture() {
    setLoading(true);
    setError(null);
    try {
      if (Platform.OS === 'web') {
        // Use browser Geolocation API
        return await new Promise<{ lat: number; long: number } | null>((resolve) => {
          if (!navigator.geolocation) {
            // Return dummy coords on web if geolocation unavailable
            const result = { lat: 0, long: 0 };
            setCoords(result);
            resolve(result);
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const result = { lat: pos.coords.latitude, long: pos.coords.longitude };
              setCoords(result);
              resolve(result);
            },
            () => {
              // Fallback to 0,0 on web if denied
              const result = { lat: 0, long: 0 };
              setCoords(result);
              resolve(result);
            }
          );
        });
      }

      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied');
        return null;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const result = { lat: loc.coords.latitude, long: loc.coords.longitude };
      setCoords(result);
      return result;
    } catch {
      setError('Failed to get location');
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { coords, loading, error, capture };
}
