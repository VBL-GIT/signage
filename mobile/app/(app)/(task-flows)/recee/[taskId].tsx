import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet, Alert, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SignageCaptureList, SignageDraft, makeEmptySignage } from '../../../../components/forms/SignageCaptureList';
import { Button } from '../../../../components/ui/Button';
import { useUpload } from '../../../../hooks/useUpload';
import { useDraft } from '../../../../hooks/useDraft';
import { DraftBanner } from '../../../../components/ui/DraftBanner';
import { fileExists } from '../../../../utils/drafts';
import { useAuthStore } from '../../../../store/auth.store';
import { getTask, submitRecee, taskReached, ReceeSignagePayload } from '../../../../services/tasks.api';
import { apiError } from '../../../../services/api';
import { Task } from '../../../../types/domain';
import { Coords, haversineMeters } from '../../../../utils/distance';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { colors, spacing, radius } from '../../../../constants/theme';

export default function ReceeFlow() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  // Hidden Tabs.Screen singleton reused across tasks — key the inner flow by taskId
  // so capture drafts fully reset per task (no image leaks between recee tasks).
  const [resetNonce, setResetNonce] = useState(0);
  if (!taskId) return null;
  return <ReceeFlowInner key={`${taskId}:${resetNonce}`} taskId={taskId} onReset={() => setResetNonce((n) => n + 1)} />;
}

function ReceeFlowInner({ taskId, onReset }: { taskId: string; onReset: () => void }) {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const { uploadAll, uploading } = useUpload();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [signages, setSignages] = useState<SignageDraft[]>([makeEmptySignage()]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    getTask(taskId)
      .then(setTask)
      .catch((e) => setLoadError(apiError(e)))
      .finally(() => setLoading(false));
  }, [taskId, reloadKey]);

  // Autosaved draft: photos, per-signage details and notes survive an app kill or a
  // dropped connection. Photos whose file has gone missing are cleared, not kept broken.
  const draft = useDraft<{ signages: SignageDraft[]; notes: string }>(
    userId ? `${userId}_recee_${taskId}` : null,
    { signages, notes },
    {
      enabled: !!task,
      isEmpty: (d) => !d.notes && d.signages.every((s) => !s.uri && !s.signage_type && !s.size.boarding_size_id && !s.size.custom_width_cm),
      onRestore: async (d) => {
        const restored = await Promise.all(d.signages.map(async (s) =>
          (await fileExists(s.uri)) ? s : { ...s, uri: null, coords: null, annotation: null }));
        if (restored.length) setSignages(restored);
        setNotes(d.notes ?? '');
      },
    }
  );

  const storeCoords: Coords | null =
    task?.store_lat != null && task?.store_long != null
      ? { lat: Number(task.store_lat), long: Number(task.store_long) }
      : null;

  async function handleSubmit() {
    for (let i = 0; i < signages.length; i++) {
      const s = signages[i];
      if (!s.uri || !s.coords) { Alert.alert('Required', `Capture a photo for Signage ${i + 1}`); return; }
      if (!s.signage_type) { Alert.alert('Required', `Select a signage type for Signage ${i + 1}`); return; }
      if (!s.size.boarding_size_id && !(s.size.custom_width_cm && s.size.custom_height_cm)) {
        Alert.alert('Required', `Select a size for Signage ${i + 1}`); return;
      }
    }
    setSubmitting(true);
    try {
      const firstCoords = signages[0].coords!;
      const urls = await uploadAll(signages.map((s) => s.uri!));
      const failed = urls.findIndex((u) => !u);
      if (failed >= 0) {
        Alert.alert('Upload Failed', `Could not upload the photo for Signage ${failed + 1}. Your draft is saved — check your connection and try again.`);
        return;
      }
      const payload: ReceeSignagePayload[] = signages.map((s, i) => ({
        photo_url: urls[i]!,
        lat: s.coords!.lat,
        long: s.coords!.long,
        signage_type: s.signage_type!,
        boarding_size_id: s.size.boarding_size_id,
        custom_width_cm: s.size.custom_width_cm,
        custom_height_cm: s.size.custom_height_cm,
        annotation: s.annotation ?? undefined,
        distance_from_store_m: i === 0 && storeCoords ? haversineMeters(s.coords!, storeCoords) : undefined,
        distance_from_first_m: i > 0 ? haversineMeters(s.coords!, firstCoords) : undefined,
      }));
      try {
        await submitRecee(taskId, { notes: notes || undefined, signages: payload });
      } catch (e) {
        // The response may have been lost after the server accepted it.
        if (!(await taskReached(taskId, ['recee_submitted']))) throw e;
      }
      await draft.clear();
      Alert.alert('Recee Submitted', 'Waiting for approval.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: unknown) {
      Alert.alert('Recee Submission Failed', apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!draft.hydrated) return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <DraftBanner savedAt={draft.restoredAt} onDiscard={async () => { await draft.clear(); onReset(); }} />
      <Text style={styles.title}>Recee Submission</Text>
      {task?.store_name && <Text style={styles.sub}>{task.store_name}</Text>}
      {!storeCoords && <Text style={styles.warn}>Store location unknown — distance from store can't be computed.</Text>}

      <SignageCaptureList storeCoords={storeCoords} value={signages} onChange={setSignages} />

      <Text style={styles.fieldLabel}>Notes (optional)</Text>
      <TextInput
        style={styles.input}
        value={notes}
        onChangeText={setNotes}
        placeholder="Any notes about the recee..."
        multiline
        placeholderTextColor={colors.textMuted}
      />

      <Button
        title={submitting || uploading ? 'Submitting…' : 'Submit Recee'}
        onPress={handleSubmit}
        loading={submitting || uploading}
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
  warn: { fontSize: 12, color: colors.danger },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, minHeight: 70, textAlignVertical: 'top', color: colors.textPrimary,
  },
  btn: { marginTop: spacing.sm },
});
