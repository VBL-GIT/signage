import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PlannedSignageCapture, InstallShot } from '../../../../components/forms/SignageCaptureList';
import { PamphletDistribution, PamphletShot } from '../../../../components/forms/PamphletDistribution';
import { AnnotatedImage } from '../../../../components/ui/AnnotatedImage';
import { Button } from '../../../../components/ui/Button';
import { useUpload } from '../../../../hooks/useUpload';
import { getTask, submitInstallation, InstallSignagePayload, PamphletPhotoPayload } from '../../../../services/tasks.api';
import { apiError } from '../../../../services/api';
import { Task, TaskStep } from '../../../../types/domain';
import { SIGNAGE_TYPE_LABELS } from '../../../../constants/taskTypes';
import { Coords, haversineMeters } from '../../../../utils/distance';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { colors, spacing, radius } from '../../../../constants/theme';

export default function InstallFlow() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  // This screen is a hidden Tabs.Screen, so it's a persistent singleton that gets
  // REUSED across tasks (only the taskId param changes). Keying the inner flow by
  // taskId forces a full remount per task, so capture drafts never leak between
  // pending tasks of the same type.
  if (!taskId) return null;
  return <InstallFlowInner key={taskId} taskId={taskId} />;
}

function InstallFlowInner({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { upload, uploading } = useUpload();

  const [task, setTask] = useState<Task | null>(null);
  const [parentRecee, setParentRecee] = useState<TaskStep | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [shots, setShots] = useState<InstallShot[]>([]);
  // pamphlet-only state
  const [pamphletShots, setPamphletShots] = useState<PamphletShot[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const t = await getTask(taskId);
        setTask(t);
        if (t.installation_type !== 'direct') {
          setShots((t.signage_plan ?? []).map(() => ({ uri: null, coords: null })));
        }
        if (t.installation_type === 'post_recee' && t.parent_task_id) {
          const parent = await getTask(t.parent_task_id);
          setParentRecee(parent.steps?.find((s) => s.step_type === 'recee') ?? null);
        }
      } catch (e) {
        setLoadError(apiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId, reloadKey]);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!task) return <Text style={styles.error}>Task not found</Text>;

  const isPamphlet = task.installation_type === 'direct';
  const storeCoords: Coords | null =
    task.store_lat != null && task.store_long != null
      ? { lat: Number(task.store_lat), long: Number(task.store_long) }
      : null;
  const plan = task.signage_plan ?? [];

  async function handlePamphletSubmit() {
    if (pamphletShots.length === 0) { Alert.alert('Required', 'Take at least one photo'); return; }
    setSubmitting(true);
    try {
      const uploaded: PamphletPhotoPayload[] = [];
      for (const s of pamphletShots) {
        const url = await upload(s.uri);
        if (!url) { Alert.alert('Upload Failed', 'Could not upload a photo.'); return; }
        uploaded.push({
          photo_url: url,
          lat: s.lat ?? undefined,
          long: s.long ?? undefined,
          area_label: s.area,
          brand_label: s.brand,
        });
      }
      await submitInstallation(taskId, {
        notes: notes || undefined,
        photos: uploaded,
      });
      Alert.alert('Done', 'Task marked as completed.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: unknown) {
      Alert.alert('Installation Failed', apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBoardingSubmit() {
    if (plan.length === 0) { Alert.alert('No plan', 'This task has no signage plan to install.'); return; }
    for (let i = 0; i < plan.length; i++) {
      if (!shots[i]?.uri || !shots[i]?.coords) { Alert.alert('Required', `Capture a photo for Signage ${i + 1}`); return; }
    }
    setSubmitting(true);
    try {
      const firstCoords = shots[0].coords!;
      const recee1 = plan[0]?.recee_lat != null && plan[0]?.recee_long != null
        ? { lat: Number(plan[0].recee_lat), long: Number(plan[0].recee_long) }
        : null;
      const payload: InstallSignagePayload[] = [];
      for (let i = 0; i < plan.length; i++) {
        const shot = shots[i];
        const url = await upload(shot.uri!);
        if (!url) { Alert.alert('Upload Failed', `Could not upload the photo for Signage ${i + 1}.`); return; }
        payload.push({
          signage_index: plan[i].signage_index,
          photo_url: url,
          lat: shot.coords!.lat,
          long: shot.coords!.long,
          distance_from_store_m: i === 0 && storeCoords ? haversineMeters(shot.coords!, storeCoords) : undefined,
          distance_from_recee_m: i === 0 && recee1 ? haversineMeters(shot.coords!, recee1) : undefined,
          distance_from_first_m: i > 0 ? haversineMeters(shot.coords!, firstCoords) : undefined,
        });
      }
      await submitInstallation(taskId, { notes: notes || undefined, signages: payload });
      Alert.alert('Done', 'Installation marked as completed.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: unknown) {
      Alert.alert('Installation Failed', apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Text style={styles.title}>Installation</Text>
      {task.store_name && <Text style={styles.sub}>{task.store_name}</Text>}

      {/* -------------------- Pamphlet distribution -------------------- */}
      {isPamphlet && (
        <>
          <PamphletDistribution
            target={task.target_pamphlet_count}
            value={pamphletShots}
            onChange={setPamphletShots}
          />
        </>
      )}

      {/* -------------------- Boarding install (locked plan) -------------------- */}
      {!isPamphlet && (
        <>
          {task.installation_type === 'post_recee' && parentRecee && (
            <View>
              <Text style={styles.sectionTitle}>From the recee</Text>
              <View style={styles.refGrid}>
                {parentRecee.photos.map((p) => (
                  <View key={p.id} style={styles.refItem}>
                    <AnnotatedImage
                      uri={p.photo_url}
                      annotation={p.annotation}
                      markerX={p.marker_x}
                      markerY={p.marker_y}
                      style={styles.refPhotoWrap}
                    />
                    <Text style={styles.refCaption}>
                      #{p.signage_index ?? '?'} {p.signage_type ? `· ${SIGNAGE_TYPE_LABELS[p.signage_type]}` : ''}
                    </Text>
                    {p.boarding_size_label && <Text style={styles.refCaption}>{p.boarding_size_label}</Text>}
                  </View>
                ))}
              </View>
            </View>
          )}

          <Text style={styles.sectionTitle}>Signages to install ({plan.length})</Text>
          {plan.length === 0 ? (
            <Text style={styles.warn}>No signage plan has been set for this task.</Text>
          ) : (
            <PlannedSignageCapture plan={plan} storeCoords={storeCoords} value={shots} onChange={setShots} />
          )}
        </>
      )}

      <Text style={styles.fieldLabel}>Notes (optional)</Text>
      <TextInput
        style={[styles.input, { minHeight: 70 }]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Any notes about the installation..."
        multiline
        placeholderTextColor={colors.textMuted}
      />

      <Button
        title={submitting || uploading ? 'Submitting…'
          : isPamphlet ? `Submit (${pamphletShots.length} pamphlet${pamphletShots.length === 1 ? '' : 's'})`
          : 'Mark as Completed'}
        onPress={isPamphlet ? handlePamphletSubmit : handleBoardingSubmit}
        loading={submitting || uploading}
        disabled={isPamphlet && pamphletShots.length === 0}
        style={styles.btn}
      />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.md, backgroundColor: colors.background, gap: spacing.md },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  sub: { fontSize: 15, fontWeight: '600', color: colors.textSecondary, marginTop: -8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  warn: { fontSize: 13, color: colors.danger },
  meta: { fontSize: 13, color: colors.textSecondary },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.textPrimary, fontSize: 16,
  },
  location: { fontSize: 12, color: colors.success },
  btn: { marginTop: spacing.md },
  error: { textAlign: 'center', color: colors.danger, marginTop: spacing.xl },
  refGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  refItem: { width: 100 },
  refPhotoWrap: { width: 100, height: 100, borderRadius: radius.md, overflow: 'hidden', position: 'relative' },
  refPhoto: { width: '100%', height: '100%' },
  pin: {
    position: 'absolute', width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.danger, borderWidth: 2, borderColor: '#fff',
    marginLeft: -7, marginTop: -7,
  },
  refCaption: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});
