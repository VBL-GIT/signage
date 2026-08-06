import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '../../constants/taskStatuses';
import { radius, spacing } from '../../constants/theme';

interface Props {
  status: string;
}

export function StatusBadge({ status }: Props) {
  const color = TASK_STATUS_COLORS[status] ?? '#6B7280';
  const label = TASK_STATUS_LABELS[status] ?? status;
  return (
    <View style={[styles.badge, { backgroundColor: color + '20', borderColor: color }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 12, fontWeight: '600' },
});
