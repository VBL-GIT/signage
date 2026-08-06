import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { getBoardingSizes } from '../../services/reference.api';
import { BoardingSize } from '../../types/domain';
import { cmToIn, inToCm } from '../../utils/units';
import { colors, radius, spacing } from '../../constants/theme';

interface Props {
  onSelect: (value: { boarding_size_id?: string; custom_width_cm?: number; custom_height_cm?: number }) => void;
  initial?: { boarding_size_id?: string | null; custom_width_cm?: number | null; custom_height_cm?: number | null };
}

export function BoardingSizeSelector({ onSelect, initial }: Props) {
  const [sizes, setSizes] = useState<BoardingSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'standard' | 'custom'>(
    initial?.custom_width_cm && initial?.custom_height_cm ? 'custom' : 'standard'
  );
  const [selectedId, setSelectedId] = useState<string | null>(initial?.boarding_size_id ?? null);
  // Inputs are in inches; stored/emitted values are cm.
  const [customW, setCustomW] = useState(initial?.custom_width_cm ? String(cmToIn(initial.custom_width_cm)) : '');
  const [customH, setCustomH] = useState(initial?.custom_height_cm ? String(cmToIn(initial.custom_height_cm)) : '');

  useEffect(() => {
    getBoardingSizes().then(setSizes).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (initial?.boarding_size_id) onSelect({ boarding_size_id: initial.boarding_size_id });
    else if (initial?.custom_width_cm && initial?.custom_height_cm) {
      onSelect({ custom_width_cm: initial.custom_width_cm, custom_height_cm: initial.custom_height_cm });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectStandard(id: string) {
    setSelectedId(id);
    onSelect({ boarding_size_id: id });
  }

  function handleCustomChange(w: string, h: string) {
    setCustomW(w);
    setCustomH(h);
    const wn = parseInt(w, 10);
    const hn = parseInt(h, 10);
    if (!isNaN(wn) && !isNaN(hn)) {
      onSelect({ custom_width_cm: inToCm(wn), custom_height_cm: inToCm(hn) });
    }
  }

  if (loading) return <ActivityIndicator />;

  return (
    <View>
      <View style={styles.toggle}>
        {(['standard', 'custom'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => { setMode(m); setSelectedId(null); onSelect({}); }}
            style={[styles.toggleBtn, mode === m && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>
              {m === 'standard' ? 'Standard Sizes' : 'Custom Size'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'standard' ? (
        <View style={styles.grid}>
          {sizes.map((s) => (
            <TouchableOpacity
              key={s.id}
              onPress={() => selectStandard(s.id)}
              style={[styles.sizeCard, selectedId === s.id && styles.sizeCardSelected]}
            >
              <Text style={[styles.sizeLabel, selectedId === s.id && { color: colors.primary }]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.customRow}>
          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>Width (in)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={customW}
              onChangeText={(v) => handleCustomChange(v, customH)}
              placeholder="e.g. 48"
            />
          </View>
          <Text style={styles.x}>×</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>Height (in)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={customH}
              onChangeText={(v) => handleCustomChange(customW, v)}
              placeholder="e.g. 36"
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  toggleBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.background },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { color: colors.textSecondary, fontWeight: '500' },
  toggleTextActive: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sizeCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  sizeCardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  sizeLabel: { color: colors.textPrimary, fontWeight: '500' },
  customRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  inputWrap: { flex: 1 },
  inputLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, fontSize: 16,
  },
  x: { fontSize: 20, color: colors.textSecondary, paddingBottom: spacing.sm },
});
