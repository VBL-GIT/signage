import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

export interface LocationReadyState {
  ready: boolean;
  checking: boolean;
  servicesOff: boolean;   // GPS / location services turned off at the OS level
  denied: boolean;        // permission denied
  recheck: () => void;
}

/**
 * Ensures location permission is granted AND device location services are on.
 * Re-checks whenever the app returns to the foreground (e.g. after the user
 * toggles GPS in settings). When `enabled` is false the gate is always ready.
 */
export function useLocationReady(enabled: boolean): LocationReadyState {
  const [ready, setReady] = useState(!enabled);
  const [checking, setChecking] = useState(false);
  const [servicesOff, setServicesOff] = useState(false);
  const [denied, setDenied] = useState(false);

  const check = useCallback(async () => {
    if (!enabled) { setReady(true); return; }
    setChecking(true);
    try {
      const servicesOn = await Location.hasServicesEnabledAsync();
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
      }
      setServicesOff(!servicesOn);
      setDenied(status !== 'granted');
      setReady(servicesOn && status === 'granted');
    } catch {
      setReady(false);
    } finally {
      setChecking(false);
    }
  }, [enabled]);

  useEffect(() => { check(); }, [check]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, [check]);

  return { ready, checking, servicesOff, denied, recheck: check };
}
