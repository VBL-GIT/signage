import React from 'react';
import { Modal, View, Text, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { Button } from '../ui/Button';
import { useAuthStore } from '../../store/auth.store';
import { useConnectivity } from '../../hooks/useConnectivity';
import { useLocationReady } from '../../hooks/useLocationReady';
import { colors, spacing } from '../../constants/theme';

/**
 * Full-screen blocking gates rendered above the whole app:
 *  - Offline blocker: shown to anyone whenever the internet connection drops.
 *  - Location blocker: shown to employees until location permission + services are on.
 * Both are Modals so they sit on top of every screen without affecting navigation.
 */
export function AppGate() {
  const role = useAuthStore((s) => s.user?.role);
  const loggedIn = !!role;
  const isEmployee = role === 'employee';

  const online = useConnectivity();
  const { ready, checking, servicesOff, denied, recheck } = useLocationReady(loggedIn && isEmployee);

  const showOffline = loggedIn && !online;
  const showLocation = loggedIn && isEmployee && online && !ready;

  return (
    <>
      <Modal visible={showOffline} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.icon}>📶</Text>
            <Text style={styles.title}>No Internet Connection</Text>
            <Text style={styles.body}>
              A stable connection is required to use the app. Please reconnect to Wi-Fi or mobile data —
              this screen will close automatically once you're back online.
            </Text>
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
          </View>
        </View>
      </Modal>

      <Modal visible={showLocation} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.icon}>📍</Text>
            <Text style={styles.title}>Location Required</Text>
            <Text style={styles.body}>
              {servicesOff
                ? 'Location services (GPS) are turned off. Please enable them to continue — every visit is location-stamped.'
                : denied
                ? 'Location permission is needed so visits can be location-stamped. Please allow location access.'
                : 'Checking location access…'}
            </Text>
            <Button title={checking ? 'Checking…' : 'Enable & Retry'} onPress={recheck} loading={checking} style={styles.btn} />
            <Button title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} style={styles.btn} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: spacing.lg, width: '100%', maxWidth: 360, alignItems: 'center' },
  icon: { fontSize: 40, marginBottom: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs, textAlign: 'center' },
  body: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: spacing.sm, alignSelf: 'stretch' },
});
