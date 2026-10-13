import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { colors, radius, spacing } from '../../constants/theme';

interface Props {
  savedAt: number | null;
  onDiscard: () => void;
}

/** Shown when a screen opened with a previously saved draft restored. */
export function DraftBanner({ savedAt, onDiscard }: Props) {
  if (!savedAt) return null;
  const when = new Date(savedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <View style={styles.box}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Draft restored</Text>
        <Text style={styles.sub}>Continuing from {when}. Your work saves automatically.</Text>
      </View>
      <TouchableOpacity
        onPress={() => Alert.alert('Discard draft?', 'Photos and details saved so far will be deleted.', [
          { text: 'Keep', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onDiscard },
        ])}
      >
        <Text style={styles.link}>Start over</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm,
    backgroundColor: colors.primaryLight, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary,
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.primary },
  sub: { fontSize: 12, color: colors.textSecondary },
  link: { fontSize: 13, fontWeight: '700', color: colors.danger },
});
