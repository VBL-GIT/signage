import React, { createContext, useContext, useRef, useState } from 'react';
import { Modal, View, Image, Text, TouchableOpacity, StyleSheet, useWindowDimensions, Animated, PanResponder, GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { parseAnnotation, strokeToPath } from './PhotoAnnotator';
import { colors } from '../../constants/theme';

interface LightboxTarget {
  uri: string;
  annotation?: string | null;
  markerX?: number | null;
  markerY?: number | null;
}

interface LightboxContextValue {
  open: (target: LightboxTarget) => void;
}

const LightboxContext = createContext<LightboxContextValue | null>(null);

export function useLightbox(): LightboxContextValue {
  const ctx = useContext(LightboxContext);
  if (!ctx) throw new Error('useLightbox must be used within a LightboxProvider');
  return ctx;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

function touchDistance(touches: GestureResponderEvent['nativeEvent']['touches']): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** The enlarged image with pinch-to-zoom and one-finger pan. */
function ZoomableImage({ target, size }: { target: LightboxTarget; size: number }) {
  const data = parseAnnotation(target.annotation ?? null);
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  // Live values (Animated.Value can't be read synchronously) + per-gesture baseline.
  const cur = useRef({ scale: 1, x: 0, y: 0 });
  const base = useRef({ scale: 1, x: 0, y: 0 });
  const mode = useRef<'none' | 'pinch' | 'pan'>('none');
  const pinchStart = useRef(1);
  const panStart = useRef({ dx: 0, dy: 0 });

  function apply(next: { scale?: number; x?: number; y?: number }) {
    if (next.scale != null) { cur.current.scale = next.scale; scale.setValue(next.scale); }
    if (next.x != null) { cur.current.x = next.x; tx.setValue(next.x); }
    if (next.y != null) { cur.current.y = next.y; ty.setValue(next.y); }
  }

  function reset() {
    // NB: must stay on the JS driver (useNativeDriver:false). The gesture drives
    // these same values with setValue(); once a value is animated with the native
    // driver, later setValue() calls no longer update the view — which silently
    // kills pinch after the first snap-back.
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: false }),
      Animated.timing(tx, { toValue: 0, duration: 150, useNativeDriver: false }),
      Animated.timing(ty, { toValue: 0, duration: 150, useNativeDriver: false }),
    ]).start();
    cur.current = { scale: 1, x: 0, y: 0 };
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2 || cur.current.scale > 1,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2 || cur.current.scale > 1,
      // Don't let the backdrop TouchableOpacity or Modal steal the pinch mid-gesture.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { mode.current = 'none'; },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          const dist = touchDistance(touches);
          if (mode.current !== 'pinch') {
            mode.current = 'pinch';
            pinchStart.current = dist;
            base.current = { ...cur.current };
          }
          apply({ scale: clamp(base.current.scale * (dist / pinchStart.current), MIN_SCALE, MAX_SCALE) });
        } else {
          if (mode.current !== 'pan') {
            mode.current = 'pan';
            base.current = { ...cur.current };
            panStart.current = { dx: g.dx, dy: g.dy };
          }
          if (cur.current.scale > 1) {
            apply({ x: base.current.x + (g.dx - panStart.current.dx), y: base.current.y + (g.dy - panStart.current.dy) });
          }
        }
      },
      onPanResponderRelease: () => {
        mode.current = 'none';
        if (cur.current.scale <= 1.01) reset();
      },
    })
  ).current;

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        { width: size, height: size },
        { transform: [{ translateX: tx }, { translateY: ty }, { scale }] },
      ]}
    >
      <Image source={{ uri: target.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      {data && (
        <Svg style={StyleSheet.absoluteFill}>
          {data.strokes.map((s, i) => (
            <Path key={i} d={strokeToPath(s.points, size, size)} stroke={colors.danger} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
      )}
      {!data && target.markerX != null && target.markerY != null && (
        <View pointerEvents="none" style={[styles.pin, { left: `${target.markerX * 100}%`, top: `${target.markerY * 100}%` }]} />
      )}
    </Animated.View>
  );
}

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<LightboxTarget | null>(null);
  const { width, height } = useWindowDimensions();
  const size = Math.min(width, height) * 0.92;

  return (
    <LightboxContext.Provider value={{ open: setTarget }}>
      {children}
      <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <View style={styles.backdrop}>
          {/* Tapping the dark area closes; the image itself owns pan/pinch gestures. */}
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setTarget(null)} />
          {target && <ZoomableImage key={target.uri} target={target} size={size} />}
          <TouchableOpacity style={styles.close} onPress={() => setTarget(null)}>
            <Text style={styles.closeText}>×</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>Pinch to zoom · drag to pan</Text>
        </View>
      </Modal>
    </LightboxContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  pin: {
    position: 'absolute', width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.danger, borderWidth: 2, borderColor: '#fff',
    marginLeft: -8, marginTop: -8,
  },
  close: {
    position: 'absolute', top: 40, right: 20, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 26, lineHeight: 30 },
  hint: { position: 'absolute', bottom: 40, color: 'rgba(255,255,255,0.6)', fontSize: 12 },
});
