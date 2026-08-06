import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * Tracks whether the device currently has a usable internet connection.
 * Treats "unknown" reachability as online to avoid false offline flashes at startup;
 * only reports offline when the OS explicitly says there's no connection.
 */
export function useConnectivity(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    function apply(state: { isConnected: boolean | null; isInternetReachable: boolean | null }) {
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    }
    NetInfo.fetch().then(apply);
    const unsub = NetInfo.addEventListener(apply);
    return () => unsub();
  }, []);

  return online;
}
