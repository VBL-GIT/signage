import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { CameraView } from 'expo-camera';
import { useCamera } from '../../hooks/useCamera';
import { Button } from './Button';
import { colors, radius, spacing } from '../../constants/theme';

interface Props {
  onPhotoCaptured: (uri: string) => void;
  photoUri?: string | null;
}

export function PhotoCapture({ onPhotoCaptured, photoUri }: Props) {
  const { permission, requestPermission, cameraRef, takePicture } = useCamera();
  const [showCamera, setShowCamera] = useState(false);

  async function handleCapture() {
    const uri = await takePicture();
    if (uri) {
      setShowCamera(false);
      onPhotoCaptured(uri);
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
          <TouchableOpacity onPress={handleCapture} style={styles.captureBtn}>
            <View style={styles.captureInner} />
          </TouchableOpacity>
          <View style={{ width: 64 }} />
        </View>
      </View>
    );
  }

  if (photoUri) {
    return (
      <View>
        <Image source={{ uri: photoUri }} style={styles.preview} />
        <Button title="Retake Photo" onPress={() => setShowCamera(true)} variant="ghost" />
      </View>
    );
  }

  return <Button title="Take Photo" onPress={() => setShowCamera(true)} />;
}

const styles = StyleSheet.create({
  permBox: { alignItems: 'center', gap: spacing.sm },
  permText: { color: colors.textSecondary },
  cameraContainer: { height: 400, borderRadius: radius.md, overflow: 'hidden' },
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
  preview: { width: '100%', height: 220, borderRadius: radius.md, marginBottom: spacing.sm },
});
