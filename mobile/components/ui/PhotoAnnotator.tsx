import React, { useRef, useState } from 'react';
import { Modal, View, Text, Image, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Button } from './Button';
import { colors, spacing } from '../../constants/theme';

export interface Stroke { points: { x: number; y: number }[] } // normalized 0..1
export interface AnnotationData { strokes: Stroke[] }

export function parseAnnotation(s?: string | null): AnnotationData | null {
  if (!s) return null;
  try {
    const d = JSON.parse(s);
    if (d && Array.isArray(d.strokes)) return d as AnnotationData;
  } catch {}
  return null;
}

export function strokeToPath(points: { x: number; y: number }[], w: number, h: number): string {
  if (!points.length) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * w).toFixed(1)} ${(p.y * h).toFixed(1)}`).join(' ');
}

interface Props {
  visible: boolean;
  uri: string;
  initial?: string | null;
  onClose: () => void;
  onSave: (annotation: string | null) => void;
}

/** Full-screen freehand drawing over a photo. Strokes are stored normalized (0..1). */
export function PhotoAnnotator({ visible, uri, initial, onClose, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const [strokes, setStrokes] = useState<Stroke[]>(() => parseAnnotation(initial)?.strokes ?? []);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const sizeRef = useRef({ w: 1, h: 1 });
  const ptsRef = useRef<{ x: number; y: number }[]>([]);
  const [, setTick] = useState(0);

  function norm(x: number, y: number) {
    const { w, h } = sizeRef.current;
    return { x: Math.max(0, Math.min(1, x / w)), y: Math.max(0, Math.min(1, y / h)) };
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        ptsRef.current = [norm(e.nativeEvent.locationX, e.nativeEvent.locationY)];
        setTick((n) => n + 1);
      },
      onPanResponderMove: (e) => {
        ptsRef.current.push(norm(e.nativeEvent.locationX, e.nativeEvent.locationY));
        setTick((n) => n + 1);
      },
      onPanResponderRelease: () => {
        if (ptsRef.current.length > 1) {
          const pts = ptsRef.current;
          setStrokes((s) => [...s, { points: pts }]);
        }
        ptsRef.current = [];
        setTick((n) => n + 1);
      },
    })
  ).current;

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    sizeRef.current = { w: width, h: height };
    setSize({ w: width, h: height });
  }

  function handleDone() {
    onSave(strokes.length ? JSON.stringify({ strokes }) : null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: spacing.md + insets.bottom }]}>
        <Text style={styles.title}>Draw to mark where the board goes</Text>
        <View style={styles.canvas} onLayout={onLayout} {...pan.panHandlers}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          <Svg style={StyleSheet.absoluteFill}>
            {strokes.map((s, i) => (
              <Path key={i} d={strokeToPath(s.points, size.w, size.h)} stroke={colors.danger} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {ptsRef.current.length > 0 && (
              <Path d={strokeToPath(ptsRef.current, size.w, size.h)} stroke={colors.danger} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </Svg>
        </View>
        <View style={styles.row}>
          <Button title="Undo" variant="secondary" onPress={() => setStrokes((s) => s.slice(0, -1))} style={styles.btn} />
          <Button title="Clear" variant="secondary" onPress={() => setStrokes([])} style={styles.btn} />
        </View>
        <View style={styles.row}>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.btn} />
          <Button title="Done" onPress={handleDone} style={styles.btn} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: spacing.md, gap: spacing.sm },
  title: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: spacing.lg },
  canvas: { flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#111' },
  row: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1 },
});
