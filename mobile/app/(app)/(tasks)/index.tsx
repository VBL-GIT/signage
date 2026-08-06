import React, { useCallback, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, Text, RefreshControl, ActivityIndicator, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getTasks } from '../../../services/tasks.api';
import { apiError } from '../../../services/api';
import { Task } from '../../../types/domain';
import { TaskCard } from '../../../components/tasks/TaskCard';
import { ErrorState } from '../../../components/ui/ErrorState';
import { colors, spacing, radius } from '../../../constants/theme';
import { useAuthStore } from '../../../store/auth.store';

type Tab = 'todo' | 'waiting' | 'done';
type TypeFilter = 'all' | 'recee' | 'post_recee' | 'direct' | 'direct_boarding';

// Three lifecycle buckets, by what the employee needs to do:
//   To Do   — needs action now (pending / recee rejected → redo)
//   Waiting — submitted, waiting on a supervisor's approval (recee_submitted)
//   Done    — finished for this employee (completed, or recee_approved)
const TABS: { key: Tab; label: string }[] = [
  { key: 'todo', label: 'To Do' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'done', label: 'Done' },
];
function tabOf(status: string): Tab {
  if (status === 'completed' || status === 'recee_approved') return 'done';
  if (status === 'recee_submitted') return 'waiting';
  return 'todo'; // pending, recee_rejected, installed
}

// Filter chips shown above both lists. Installation sub-types are surfaced
// individually since they're distinct field activities for the employee.
const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'recee', label: 'Recee' },
  { key: 'post_recee', label: 'From Recee' },
  { key: 'direct', label: 'Direct' },
  { key: 'direct_boarding', label: 'w/o Recee' },
];

export default function TasksScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('todo');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const fetchTasks = useCallback(async () => {
    if (!user) return; // Don't fetch if not authenticated — auth guard in root layout handles redirect
    setError(null);
    try {
      const data = await getTasks();
      setTasks(data);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { fetchTasks(); }, [fetchTasks]));

  const filtered = useMemo(() => {
    const matchesType = (t: Task) => {
      if (typeFilter === 'all') return true;
      if (typeFilter === 'recee') return t.task_type === 'recee';
      return t.task_type === 'installation' && t.installation_type === typeFilter;
    };
    const q = query.trim().toLowerCase();
    return tasks.filter((t) =>
      tabOf(t.status) === tab &&
      matchesType(t) &&
      (!q || (t.store_name ?? '').toLowerCase().includes(q))
    );
  }, [tasks, tab, query, typeFilter]);

  if (loading) return <ActivityIndicator style={styles.center} size="large" color={colors.primary} />;
  // Only take over the whole screen if there's nothing to show yet — a failed
  // pull-to-refresh with an already-loaded list just leaves the list as-is.
  if (error && tasks.length === 0) return <ErrorState message={error} onRetry={fetchTasks} />;

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {TABS.map((tb) => (
          <TouchableOpacity key={tb.key} style={[styles.tab, tab === tb.key && styles.tabActive]} onPress={() => setTab(tb.key)}>
            <Text style={[styles.tabText, tab === tb.key && styles.tabTextActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search by store name…"
        placeholderTextColor={colors.textMuted}
      />
      <View style={styles.typeRow}>
        {TYPE_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.typeChip, typeFilter === f.key && styles.typeChipActive]}
            onPress={() => setTypeFilter(f.key)}
          >
            <Text style={[styles.typeChipText, typeFilter === f.key && styles.typeChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTasks(); }} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {tab === 'done' ? 'No finished tasks yet' : tab === 'waiting' ? 'Nothing awaiting approval' : 'Nothing to do right now'}
          </Text>
        }
        renderItem={({ item }) => (
          <TaskCard task={item} onPress={() => router.push(`/(app)/(tasks)/${item.id}`)} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md, flexGrow: 1 },
  center: { flex: 1 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  tabBar: {
    flexDirection: 'row', marginHorizontal: spacing.md, marginTop: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 4,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },
  search: {
    marginHorizontal: spacing.md, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.sm, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.surface,
  },
  typeRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: spacing.md, marginTop: spacing.sm, gap: spacing.xs,
  },
  typeChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  typeChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  typeChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  typeChipTextActive: { color: colors.primary },
});
