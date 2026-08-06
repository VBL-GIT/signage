import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Task } from '../../types/domain';
import { StatusBadge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { taskTypeLabel } from '../../constants/taskTypes';
import { taskAge, dayLabel } from '../../utils/taskAge';
import { colors, spacing } from '../../constants/theme';

interface Props {
  task: Task;
  onPress: () => void;
}

export function TaskCard({ task, onPress }: Props) {
  const age = taskAge(task);
  const ageLabel = age.completedInDays != null ? `completed in ${dayLabel(age.completedInDays)}` : `${dayLabel(age.ageDays)} old`;
  return (
    <TouchableOpacity onPress={onPress}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.type}>{taskTypeLabel(task)}</Text>
          <View style={styles.statusCol}>
            <StatusBadge status={task.status} />
            <Text style={styles.age}>{ageLabel}</Text>
          </View>
        </View>
        {task.store_name && <Text style={styles.store}>{task.store_name}</Text>}
        {task.store_address && <Text style={styles.address} numberOfLines={1}>{task.store_address}</Text>}
        {task.brand_name && <Text style={styles.meta}>Brand: {task.brand_name}</Text>}
        <Text style={styles.date}>{new Date(task.created_at).toLocaleDateString()}</Text>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xs },
  type: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  statusCol: { alignItems: 'flex-end', gap: 2 },
  age: { fontSize: 11, color: colors.textMuted },
  store: { fontSize: 14, color: colors.textPrimary, marginBottom: 2 },
  address: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  meta: { fontSize: 12, color: colors.textSecondary },
  date: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
});
