import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet, Alert, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SignageCaptureList, SignageDraft, makeEmptySignage } from '../../../../components/forms/SignageCaptureList';
import { Button } from '../../../../components/ui/Button';
import { useUpload } from '../../../../hooks/useUpload';
import { getTask, submitRecee, ReceeSignagePayload } from '../../../../services/tasks.api';
import { apiError } from '../../../../services/api';
import { Task } from '../../../../types/domain';
import { Coords, haversineMeters } from '../../../../utils/distance';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { colors, spacing, radius } from '../../../../constants/theme';

export default function ReceeFlow() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  // Hidden Tabs.Screen singleton reused across tasks — key the inner flow by taskId
  // so capture drafts fully reset per task (no image leaks between recee tasks).
  if (!taskId) return null;
  return <ReceeFlowInner key={taskId} taskId={taskId} />;
}

function ReceeFlowInner({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { upload, uploading } = useUpload();

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
      const payload: ReceeSignagePayload[] = [];
      for (let i = 0; i < signages.length; i++) {
        const s = signages[i];
        const url = await upload(s.uri!);
        if (!url) { Alert.alert('Upload Failed', `Could not upload the photo for Signage ${i + 1}.`); return; }
        payload.push({
          photo_url: url,
          lat: s.coords!.lat,
          long: s.coords!.long,
          signage_type: s.signage_type!,
          boarding_size_id: s.size.boarding_size_id,
          custom_width_cm: s.size.custom_width_cm,
          custom_height_cm: s.size.custom_height_cm,
          annotation: s.annotation ?? undefined,
          distance_from_store_m: i === 0 && storeCoords ? haversineMeters(s.coords!, storeCoords) : undefined,
          distance_from_first_m: i > 0 ? haversineMeters(s.coords!, firstCoords) : undefined,
        });
      }
      await submitRecee(taskId, { notes: notes || undefined, signages: payload });
      Alert.alert('Recee Submitted', 'Waiting for approval.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: unknown) {
      Alert.alert('Recee Submission Failed', apiError(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
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
