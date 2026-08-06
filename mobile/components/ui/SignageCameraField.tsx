import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView } from 'expo-camera';
import { useCamera } from '../../hooks/useCamera';
import { useLocation } from '../../hooks/useLocation';
import { Button } from './Button';
import { Coords } from '../../utils/distance';
import { colors, radius, spacing } from '../../constants/theme';

interface Props {
  uri: string | null;
  onCapture: (uri: string, coords: Coords | null) => void;
}

/** Captures one photo with the live camera and the GPS coordinates at capture time. */
export function SignageCameraField({ uri, onCapture }: Props) {
  const { permission, requestPermission, cameraRef, takePicture } = useCamera();
  const { capture, loading: locLoading } = useLocation();
  const [showCamera, setShowCamera] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleCapture() {
    setBusy(true);
    try {
      const u = await takePicture();
      if (!u) return;
      setShowCamera(false);
      const coords = await capture();
      onCapture(u, coords);
    } finally {
      setBusy(false);
    }
  }

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={styles.permBox}>
        <Text style={styles.permText}>Camera permission required</Text>
        <Button title="Grant Permission" onPress={requestPermission} />
      </View>
    );
  }

  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        <View style={styles.cameraControls}>
          <TouchableOpacity onPress={() => setShowCamera(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCapture} style={styles.captureBtn} disabled={busy}>
            <View style={styles.captureInner} />
          </TouchableOpacity>
          <View style={{ width: 64 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Text style={styles.thumbEmptyText}>No photo</Text>
        </View>
      )}
      <View style={styles.actions}>
        {(busy || locLoading) && <ActivityIndicator color={colors.primary} />}
        <Button
          title={uri ? 'Retake Photo' : 'Capture Photo'}
          variant={uri ? 'secondary' : 'primary'}
          onPress={() => setShowCamera(true)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  permBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  permText: { color: colors.textSecondary },
  cameraContainer: { height: 380, borderRadius: radius.md, overflow: 'hidden' },
  camera: { flex: 1 },
  cameraControls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, paddingTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  captureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  cancelBtn: { width: 64, alignItems: 'center' },
  cancelText: { color: '#fff', fontSize: 15 },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  thumb: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.border },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbEmptyText: { fontSize: 11, color: colors.textMuted },
  actions: { flex: 1, gap: spacing.xs },
});
