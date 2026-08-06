import React, { useState } from 'react';
import { View, Image, Pressable, Text, StyleSheet, LayoutChangeEvent, Modal } from 'react-native';
import { Button } from './Button';
import { colors, radius, spacing } from '../../constants/theme';

export interface MarkerPoint { x: number; y: number }

interface Props {
  visible: boolean;
  uri: string;
  initialMarker?: MarkerPoint | null;
  onClose: () => void;
  onSave: (marker: MarkerPoint | null) => void;
}

export function PhotoMarker({ visible, uri, initialMarker, onClose, onSave }: Props) {
  const [marker, setMarker] = useState<MarkerPoint | null>(initialMarker ?? null);
  const [size, setSize] = useState({ width: 1, height: 1 });

  function handleLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }

  function handlePress(e: { nativeEvent: { locationX: number; locationY: number } }) {
    const { locationX, locationY } = e.nativeEvent;
    setMarker({ x: locationX / size.width, y: locationY / size.height });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.title}>Tap on the photo to mark where the board should go</Text>
        <Pressable onPress={handlePress} onLayout={handleLayout} style={styles.imageWrap}>
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
          {marker && (
            <View
              pointerEvents="none"
              style={[
                styles.pin,
                { left: `${marker.x * 100}%`, top: `${marker.y * 100}%` },
              ]}
            />
          )}
        </Pressable>
        <View style={styles.actions}>
          <Button title="Clear Mark" variant="ghost" onPress={() => setMarker(null)} style={styles.btn} />
          <Button title="Save" onPress={() => { onSave(marker); onClose(); }} style={styles.btn} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: spacing.md, justifyContent: 'center' },
  title: { color: '#fff', textAlign: 'center', marginBottom: spacing.md, fontSize: 14 },
  imageWrap: { flex: 1, position: 'relative' },
  image: { width: '100%', height: '100%' },
  pin: {
    position: 'absolute', width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.danger, borderWidth: 2, borderColor: '#fff',
    marginLeft: -12, marginTop: -12,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1, borderRadius: radius.md },
});
