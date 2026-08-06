import React, { useState } from 'react';
import { View, Image, StyleSheet, LayoutChangeEvent, StyleProp, ViewStyle, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { parseAnnotation, strokeToPath } from './PhotoAnnotator';
import { useLightbox } from './Lightbox';
import { colors } from '../../constants/theme';

interface Props {
  uri: string;
  annotation?: string | null;
  /** Back-compat: render a single dot for old marker_x/marker_y data. */
  markerX?: number | null;
  markerY?: number | null;
  style?: StyleProp<ViewStyle>;
  /** Set false to disable tap-to-zoom, e.g. while capturing a fresh photo. */
  zoomable?: boolean;
}

/** A photo with the freehand annotation (or legacy dot marker) overlaid. Tap to zoom. */
export function AnnotatedImage({ uri, annotation, markerX, markerY, style, zoomable = true }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const data = parseAnnotation(annotation);
  const { open } = useLightbox();

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  }

  return (
    <TouchableOpacity
      activeOpacity={zoomable ? 0.85 : 1}
      disabled={!zoomable}
      onPress={() => open({ uri, annotation, markerX, markerY })}
      style={[styles.wrap, style]}
      onLayout={onLayout}
    >
      <Image source={{ uri }} style={StyleSheet.absoluteFill} />
      {data && size.w > 0 && (
        <Svg style={StyleSheet.absoluteFill}>
          {data.strokes.map((s, i) => (
            <Path key={i} d={strokeToPath(s.points, size.w, size.h)} stroke={colors.danger} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
      )}
      {!data && markerX != null && markerY != null && (
        <View pointerEvents="none" style={[styles.pin, { left: `${markerX * 100}%`, top: `${markerY * 100}%` }]} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', position: 'relative' },
  pin: {
    position: 'absolute', width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.danger, borderWidth: 2, borderColor: '#fff',
    marginLeft: -7, marginTop: -7,
  },
});
