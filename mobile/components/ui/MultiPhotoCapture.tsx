import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { CameraView } from 'expo-camera';
import { useCamera } from '../../hooks/useCamera';
import { Button } from './Button';
import { PhotoMarker, MarkerPoint } from './PhotoMarker';
import { colors, radius, spacing } from '../../constants/theme';

export interface CapturedPhoto {
  uri: string;
  marker?: MarkerPoint | null;
}

interface Props {
  photos: CapturedPhoto[];
  onChange: (photos: CapturedPhoto[]) => void;
  allowMarking?: boolean;
}

export function MultiPhotoCapture({ photos, onChange, allowMarking }: Props) {
  const { permission, requestPermission, cameraRef, takePicture } = useCamera();
  const [showCamera, setShowCamera] = useState(false);
  const [markingIndex, setMarkingIndex] = useState<number | null>(null);

  async function handleCapture() {
    const uri = await takePicture();
    if (uri) {
      setShowCamera(false);
      onChange([...photos, { uri }]);
    }
  }

  function handleRemove(index: number) {
    onChange(photos.filter((_, i) => i !== index));
  }

  function handleSaveMarker(marker: MarkerPoint | null) {
    if (markingIndex === null) return;
    onChange(photos.map((p, i) => (i === markingIndex ? { ...p, marker } : p)));
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

  return (
    <View>
      <View style={styles.grid}>
        {photos.map((p, i) => (
          <View key={p.uri + i} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            {p.marker && (
              <View
                pointerEvents="none"
                style={[styles.pin, { left: `${p.marker.x * 100}%`, top: `${p.marker.y * 100}%` }]}
              />
            )}
            <View style={styles.thumbActions}>
              {allowMarking && (
                <TouchableOpacity onPress={() => setMarkingIndex(i)} style={styles.thumbBtn}>
                  <Text style={styles.thumbBtnText}>Mark</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => handleRemove(i)} style={[styles.thumbBtn, styles.removeBtn]}>
                <Text style={styles.thumbBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <Button title="Add Photo" onPress={() => setShowCamera(true)} variant={photos.length ? 'secondary' : 'primary'} />

      {markingIndex !== null && (
        <PhotoMarker
          visible
          uri={photos[markingIndex].uri}
          initialMarker={photos[markingIndex].marker}
          onClose={() => setMarkingIndex(null)}
          onSave={handleSaveMarker}
        />
      )}
    </View>
  );
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  thumbWrap: { width: 100, height: 100, borderRadius: radius.md, overflow: 'hidden', position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  pin: {
    position: 'absolute', width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.danger, borderWidth: 2, borderColor: '#fff',
    marginLeft: -7, marginTop: -7,
  },
  thumbActions: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.5)',
  },
  thumbBtn: { flex: 1, paddingVertical: 4, alignItems: 'center' },
  removeBtn: {},
  thumbBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
