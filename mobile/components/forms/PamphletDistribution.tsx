import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { CameraView } from 'expo-camera';
import { useCamera } from '../../hooks/useCamera';
import { useLocation } from '../../hooks/useLocation';
import { Button } from '../ui/Button';
import { colors, spacing, radius } from '../../constants/theme';

export interface PamphletShot {
  uri: string;
  lat: number | null;
  long: number | null;
  area: string;
  brand: string;
}

interface Props {
  target: number | null;
  value: PamphletShot[];
  onChange: (v: PamphletShot[]) => void;
}

type Mode = 'idle' | 'camera' | 'form';

/**
 * Pamphlet distribution capture: the employee takes one photo per drop point.
 * Each capture grabs GPS, then asks for the store/area and brand before it
 * counts. A running Target / Taken / Pending header updates on every add and
 * delete, and a review screen lets the employee inspect and remove any photo.
 */
export function PamphletDistribution({ target, value, onChange }: Props) {
  const { permission, requestPermission, cameraRef, takePicture } = useCamera();
  const { capture } = useLocation();
  const [mode, setMode] = useState<Mode>('idle');
  const [draftUri, setDraftUri] = useState<string | null>(null);
  const [draftCoords, setDraftCoords] = useState<{ lat: number; long: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [area, setArea] = useState('');
  const [brand, setBrand] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);

  const taken = value.length;
  const pending = target != null ? Math.max(0, target - taken) : null;

  async function handleCapture() {
    const uri = await takePicture();
    if (!uri) return;
    setDraftUri(uri);
    setArea('');
    setBrand('');
    setDraftCoords(null);
    setMode('form');
    setGpsBusy(true);
    const c = await capture();          // GPS captured at the moment of the photo
    setDraftCoords(c);
    setGpsBusy(false);
  }

  function saveDraft() {
    if (!draftUri || !area.trim() || !brand.trim()) return;
    onChange([...value, {
      uri: draftUri, lat: draftCoords?.lat ?? null, long: draftCoords?.long ?? null,
      area: area.trim(), brand: brand.trim(),
    }]);
    setDraftUri(null);
    setMode('idle');
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  const tiles = (
    <View style={styles.tiles}>
      <Tile label="Target" value={target != null ? String(target) : '—'} />
      <Tile label="Taken" value={String(taken)} accent />
      <Tile label="Pending" value={pending != null ? String(pending) : '—'} />
    </View>
  );

  if (!permission) return tiles;
  if (!permission.granted) {
    return (
      <View style={{ gap: spacing.md }}>
        {tiles}
        <View style={styles.permBox}>
          <Text style={styles.permText}>Camera permission required</Text>
          <Button title="Grant Permission" onPress={requestPermission} />
        </View>
      </View>
    );
  }

  // ---- camera ----
  if (mode === 'camera') {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        <View style={styles.cameraControls}>
          <TouchableOpacity onPress={() => setMode('idle')} style={styles.sideBtn}>
            <Text style={styles.sideText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCapture} style={styles.captureBtn}>
            <View style={styles.captureInner} />
          </TouchableOpacity>
          <View style={{ width: 64 }} />
        </View>
      </View>
    );
  }

  // ---- per-photo entry form ----
  if (mode === 'form' && draftUri) {
    const canSave = !!area.trim() && !!brand.trim();
    return (
      <View style={{ gap: spacing.md }}>
        {tiles}
        <Text style={styles.formTitle}>Pamphlet #{taken + 1}</Text>
        <Image source={{ uri: draftUri }} style={styles.preview} />
        <Text style={styles.gps}>
          {gpsBusy ? '📍 Getting location…'
            : draftCoords ? `📍 ${draftCoords.lat.toFixed(5)}, ${draftCoords.long.toFixed(5)}`
            : '📍 Location unavailable'}
        </Text>
        <View>
          <Text style={styles.label}>Store / Area *</Text>
          <TextInput style={styles.input} value={area} onChangeText={setArea}
            placeholder="e.g. MG Road, near Store 12" placeholderTextColor={colors.textMuted} />
        </View>
        <View>
          <Text style={styles.label}>Brand *</Text>
          <TextInput style={styles.input} value={brand} onChangeText={setBrand}
            placeholder="e.g. Pepsi" placeholderTextColor={colors.textMuted} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title="Retake" variant="secondary" onPress={() => setMode('camera')} style={{ flex: 1 }} />
          <Button title="Save Photo" onPress={saveDraft} disabled={!canSave} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }

  // ---- idle ----
  return (
    <View style={{ gap: spacing.md }}>
      {tiles}
      <Button title="📷 Take Photo" onPress={() => setMode('camera')} />
      {taken > 0 && (
        <Button title={`Review Photos (${taken})`} variant="secondary" onPress={() => setReviewOpen(true)} />
      )}

      <Modal visible={reviewOpen} animationType="slide" onRequestClose={() => setReviewOpen(false)}>
        <View style={styles.reviewScreen}>
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewTitle}>Photos taken ({taken})</Text>
            <TouchableOpacity onPress={() => setReviewOpen(false)}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            {value.length === 0 && <Text style={styles.empty}>No photos yet.</Text>}
            {value.map((s, i) => (
              <View key={s.uri + i} style={styles.reviewRow}>
                <Image source={{ uri: s.uri }} style={styles.reviewThumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.reviewIdx}>#{i + 1}</Text>
                  <Text style={styles.reviewMeta}>🏬 {s.area}</Text>
                  <Text style={styles.reviewMeta}>🏷️ {s.brand}</Text>
                  <Text style={styles.reviewMetaMuted}>
                    {s.lat != null && s.long != null ? `📍 ${s.lat.toFixed(5)}, ${s.long.toFixed(5)}` : '📍 —'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => remove(i)} style={styles.deleteBtn}>
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[styles.tile, accent && styles.tileAccent]}>
      <Text style={[styles.tileValue, accent && { color: colors.primary }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center',
  },
  tileAccent: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
  tileLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  permBox: { alignItems: 'center', gap: spacing.sm },
  permText: { color: colors.textSecondary },

  cameraContainer: { height: 440, borderRadius: radius.md, overflow: 'hidden' },
  camera: { flex: 1 },
  cameraControls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, paddingTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  captureBtn: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  captureInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  sideBtn: { width: 64, alignItems: 'center' },
  sideText: { color: '#fff', fontSize: 15 },

  formTitle: { fontSize: 16, fontWeight: '700', color: colors.primary },
  preview: { width: '100%', height: 240, borderRadius: radius.md, backgroundColor: colors.background },
  gps: { fontSize: 13, color: colors.success, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.textPrimary, fontSize: 16, backgroundColor: colors.surface,
  },

  reviewScreen: { flex: 1, backgroundColor: colors.background },
  reviewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.md, paddingTop: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  reviewTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  doneText: { fontSize: 16, fontWeight: '700', color: colors.primary },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  reviewRow: {
    flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm,
  },
  reviewThumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.background },
  reviewIdx: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  reviewMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  reviewMetaMuted: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  deleteBtn: { alignSelf: 'center', paddingHorizontal: spacing.sm, paddingVertical: 6 },
  deleteText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
});
