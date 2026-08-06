import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { SignageCameraField } from '../ui/SignageCameraField';
import { PhotoAnnotator } from '../ui/PhotoAnnotator';
import { AnnotatedImage } from '../ui/AnnotatedImage';
import { useLightbox } from '../ui/Lightbox';
import { BoardingSizeSelector } from './BoardingSizeSelector';
import { SignageType, SignagePlanItem } from '../../types/domain';
import { SIGNAGE_TYPES, SIGNAGE_TYPE_LABELS } from '../../constants/taskTypes';
import { Coords, haversineMeters, formatDistance } from '../../utils/distance';
import { customSizeLabel } from '../../utils/units';
import { colors, radius, spacing } from '../../constants/theme';

// ---------------------------------------------------------------- shared bits
function CountSelector({ count, max, onChange }: { count: number; max: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.chips}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <TouchableOpacity key={n} onPress={() => onChange(n)} style={[styles.chip, count === n && styles.chipSelected]}>
          <Text style={[styles.chipText, count === n && { color: colors.primary }]}>{n}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function sizeSummary(item: { boarding_size_label: string | null; custom_width_cm: number | null; custom_height_cm: number | null }): string {
  if (item.boarding_size_label) return item.boarding_size_label;
  const c = customSizeLabel(item.custom_width_cm, item.custom_height_cm);
  if (c) return `${c} (custom)`;
  return 'Not specified';
}

// ================================================================ RECEE (editable)
export interface SignageDraft {
  uri: string | null;
  coords: Coords | null;
  signage_type: SignageType | null;
  size: { boarding_size_id?: string; custom_width_cm?: number; custom_height_cm?: number };
  annotation: string | null;
}

export function makeEmptySignage(): SignageDraft {
  return { uri: null, coords: null, signage_type: null, size: {}, annotation: null };
}

interface ReceeProps {
  storeCoords: Coords | null;
  value: SignageDraft[];
  onChange: (v: SignageDraft[]) => void;
  max?: number;
}

export function SignageCaptureList({ storeCoords, value, onChange, max = 5 }: ReceeProps) {
  const [annotatingIndex, setAnnotatingIndex] = useState<number | null>(null);

  function setCount(n: number) {
    if (n === value.length) return;
    if (n < value.length) { onChange(value.slice(0, n)); return; }
    onChange([...value, ...Array.from({ length: n - value.length }, makeEmptySignage)]);
  }

  function update(i: number, patch: Partial<SignageDraft>) {
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function distanceLabel(i: number): string | null {
    const s = value[i];
    if (!s?.coords) return null;
    if (i === 0) return storeCoords ? `${formatDistance(haversineMeters(s.coords, storeCoords))} from store` : null;
    const first = value[0]?.coords;
    return first ? `${formatDistance(haversineMeters(s.coords, first))} from Signage 1` : null;
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.label}>How many signages can be installed? (max {max})</Text>
      <CountSelector count={value.length} max={max} onChange={setCount} />

      {value.map((s, i) => (
        <Card key={i} style={styles.signageCard}>
          <Text style={styles.signageTitle}>Signage {i + 1}</Text>
          <SignageCameraField uri={s.uri} onCapture={(uri, coords) => update(i, { uri, coords, annotation: null })} />
          {distanceLabel(i) && <Text style={styles.distance}>📍 {distanceLabel(i)}</Text>}
          {s.uri && (
            <View style={styles.annotateRow}>
              <Button
                title={s.annotation ? 'Edit Drawing' : 'Annotate (draw)'}
                variant="secondary"
                onPress={() => setAnnotatingIndex(i)}
                style={{ flex: 1 }}
              />
              {s.annotation && <Text style={styles.annotated}>✓ marked</Text>}
            </View>
          )}

          <Text style={styles.fieldLabel}>Signage Type</Text>
          <View style={styles.chips}>
            {SIGNAGE_TYPES.map((t) => (
              <TouchableOpacity key={t} onPress={() => update(i, { signage_type: t })} style={[styles.chip, s.signage_type === t && styles.chipSelected]}>
                <Text style={[styles.chipText, s.signage_type === t && { color: colors.primary }]}>{SIGNAGE_TYPE_LABELS[t]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Size</Text>
          <BoardingSizeSelector onSelect={(size) => update(i, { size })} />
        </Card>
      ))}

      {annotatingIndex !== null && value[annotatingIndex]?.uri && (
        <PhotoAnnotator
          visible
          uri={value[annotatingIndex]!.uri!}
          initial={value[annotatingIndex]!.annotation}
          onClose={() => setAnnotatingIndex(null)}
          onSave={(annotation) => update(annotatingIndex, { annotation })}
        />
      )}
    </View>
  );
}

// ================================================================ INSTALL (locked to plan)
export interface InstallShot {
  uri: string | null;
  coords: Coords | null;
}

interface InstallProps {
  plan: SignagePlanItem[];
  storeCoords: Coords | null;
  value: InstallShot[];
  onChange: (v: InstallShot[]) => void;
}

export function PlannedSignageCapture({ plan, storeCoords, value, onChange }: InstallProps) {
  const { open } = useLightbox();

  function update(i: number, patch: Partial<InstallShot>) {
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function distanceLines(i: number): string[] {
    const shot = value[i];
    if (!shot?.coords) return [];
    const lines: string[] = [];
    if (i === 0) {
      if (storeCoords) lines.push(`${formatDistance(haversineMeters(shot.coords, storeCoords))} from store`);
      const recee = plan[0];
      if (recee?.recee_lat != null && recee?.recee_long != null) {
        lines.push(`${formatDistance(haversineMeters(shot.coords, { lat: Number(recee.recee_lat), long: Number(recee.recee_long) }))} from 1st recee signage`);
      }
    } else {
      const first = value[0]?.coords;
      if (first) lines.push(`${formatDistance(haversineMeters(shot.coords, first))} from 1st installation photo`);
    }
    return lines;
  }

  return (
    <View style={{ gap: spacing.md }}>
      {plan.map((item, i) => (
        <Card key={item.signage_index ?? i} style={styles.signageCard}>
          <Text style={styles.signageTitle}>Signage {i + 1}</Text>

          {(item.recee_photo_url || item.artwork_image_url) && (
            <View style={styles.refRow}>
              {item.recee_photo_url && (
                <View style={styles.refCol}>
                  <Text style={styles.refLabel}>Recee reference</Text>
                  <AnnotatedImage
                    uri={item.recee_photo_url}
                    annotation={item.recee_annotation}
                    markerX={item.recee_marker_x}
                    markerY={item.recee_marker_y}
                    style={styles.refImg}
                  />
                </View>
              )}
              {item.artwork_image_url && (
                <View style={styles.refCol}>
                  <Text style={styles.refLabel}>Artwork reference</Text>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => open({ uri: item.artwork_image_url! })}>
                    <Image source={{ uri: item.artwork_image_url }} style={styles.refImg} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          <View style={styles.reqBox}>
            <Text style={styles.reqLine}>Type: {item.signage_type ? SIGNAGE_TYPE_LABELS[item.signage_type] : 'Not specified'}</Text>
            <Text style={styles.reqLine}>Size: {sizeSummary(item)}</Text>
            <Text style={styles.reqLine}>Brand: {item.brand_name ?? 'Not specified'}</Text>
            <Text style={styles.reqLine}>Artwork: {item.artwork_name ?? 'Not specified'}</Text>
          </View>
          <SignageCameraField uri={value[i]?.uri ?? null} onCapture={(uri, coords) => update(i, { uri, coords })} />
          {distanceLines(i).map((l) => (
            <Text key={l} style={styles.distance}>📍 {l}</Text>
          ))}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 20,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { color: colors.textPrimary, fontWeight: '500' },
  signageCard: { gap: spacing.xs },
  signageTitle: { fontSize: 15, fontWeight: '700', color: colors.primary },
  distance: { fontSize: 12, color: colors.success, marginTop: 2 },
  annotateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  annotated: { fontSize: 12, color: colors.success, fontWeight: '600' },
  reqBox: {
    backgroundColor: colors.background, borderRadius: radius.sm,
    padding: spacing.sm, gap: 2, marginBottom: spacing.xs,
  },
  reqLine: { fontSize: 13, color: colors.textSecondary },
  refRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginVertical: spacing.xs },
  refCol: { gap: 4 },
  refLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  refImg: { width: 150, height: 150, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.background },
});
