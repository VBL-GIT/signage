import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator, Linking, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { getTask } from '../../../services/tasks.api';
import { apiError } from '../../../services/api';
import { Task } from '../../../types/domain';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { AnnotatedImage } from '../../../components/ui/AnnotatedImage';
import { ErrorState } from '../../../components/ui/ErrorState';
import { taskTypeLabel, SIGNAGE_TYPE_LABELS } from '../../../constants/taskTypes';
import { formatDistance } from '../../../utils/distance';
import { cmToIn } from '../../../utils/units';
import { taskAge, dayLabel } from '../../../utils/taskAge';
import { colors, spacing } from '../../../constants/theme';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    setError(null);
    getTask(id)
      .then(setTask)
      .catch((e) => setError(apiError(e)))
      .finally(() => setLoading(false));
  }, [id, reloadKey]));

  if (loading) return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.primary} />;
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!task) return <Text style={styles.error}>Task not found</Text>;

  function openDirections() {
    if (!task || task.store_lat == null || task.store_long == null) return;
    const dest = `${task.store_lat},${task.store_long}`;
    const label = encodeURIComponent(task.store_name ?? 'Store');
    const url = `https://www.google.com/maps/dir/?api=1&destination=${dest}&destination_place_id=&travelmode=driving&dir_action=navigate&q=${label}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open Google Maps.'));
  }

  const hasContact = !!(task.store_contact_person || task.store_contact_no || task.store_contact_email);
  const hasLocation = task.store_lat != null && task.store_long != null;

  function renderActions() {
    if (!task) return null;
    // Employee-only app: field actions only. Approval and assignment live in the web console.
    if (task.task_type === 'recee' && task.status === 'pending') {
      return <Button title="Start Recee" onPress={() => router.push(`/(app)/(task-flows)/recee/${task.id}`)} />;
    }
    if (task.task_type === 'installation' && task.status === 'pending') {
      return (
        <Button
          title="Submit Installation"
          onPress={() => router.push(`/(app)/(task-flows)/install/${task.id}`)}
        />
      );
    }
    return null;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.card}>
        <Text style={styles.type}>{taskTypeLabel(task)}</Text>
        <View style={styles.statusRow}>
          <StatusBadge status={task.status} />
          {(() => {
            const age = taskAge(task);
            return (
              <Text style={styles.meta}>
                {age.completedInDays != null ? `completed in ${dayLabel(age.completedInDays)}` : `${dayLabel(age.ageDays)} old`}
              </Text>
            );
          })()}
        </View>
        {task.store_name && <Text style={styles.store}>{task.store_name}</Text>}
        {task.store_address && <Text style={styles.address}>{task.store_address}</Text>}
        {task.store_pincode && <Text style={styles.meta}>Pincode: {task.store_pincode}</Text>}
        {task.store_uid && <Text style={styles.meta}>Store UID: {task.store_uid}</Text>}
        {task.brand_name && <Text style={styles.meta}>Brand: {task.brand_name}</Text>}
        {task.employee_name && <Text style={styles.meta}>Employee: {task.employee_name}</Text>}
        {(() => {
          const age = taskAge(task);
          if (!age.reassigned) return null;
          return (
            <Text style={styles.meta}>
              Reassigned {age.timesReassigned}×{age.daysSinceReassignment != null ? ` · last ${dayLabel(age.daysSinceReassignment)} ago` : ''}
            </Text>
          );
        })()}
      </Card>

      {hasContact && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Store Contact</Text>
          {task.store_contact_person && <Text style={styles.meta}>👤 {task.store_contact_person}</Text>}
          {task.store_contact_no && (
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${task.store_contact_no}`)}>
              <Text style={styles.link}>📞 {task.store_contact_no}</Text>
            </TouchableOpacity>
          )}
          {task.store_contact_email && (
            <TouchableOpacity onPress={() => Linking.openURL(`mailto:${task.store_contact_email}`)}>
              <Text style={styles.link}>✉️ {task.store_contact_email}</Text>
            </TouchableOpacity>
          )}
        </Card>
      )}

      {hasLocation && (
        <TouchableOpacity activeOpacity={0.8} onPress={openDirections}>
          <Card style={styles.directionsCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.directionsTitle}>🗺️  Get Directions</Text>
              <Text style={styles.directionsSub}>Open this store in Google Maps</Text>
              <Text style={styles.coords}>{Number(task.store_lat).toFixed(5)}, {Number(task.store_long).toFixed(5)}</Text>
            </View>
            <View style={styles.directionsArrow}><Text style={styles.directionsArrowText}>➜</Text></View>
          </Card>
        </TouchableOpacity>
      )}

      {Array.isArray(task.steps) && task.steps.length > 0 && (
        <View>
          <Text style={styles.sectionTitle}>Timeline</Text>
          {task.steps.map((step) => (
            <Card key={step.id} style={styles.stepCard}>
              <Text style={styles.stepType}>{step.step_type.replace('_', ' ').toUpperCase()}</Text>
              <Text style={styles.stepBy}>{step.performed_by_name} · {new Date(step.timestamp).toLocaleString()}</Text>
              {step.photos.length > 0 && (
                <View style={styles.signageList}>
                  {step.photos.map((p) => {
                    const hasDetails = p.signage_index != null || !!p.signage_type || !!p.boarding_size_label || !!p.brand_name || !!p.area_label ||
                      p.distance_from_store_m != null || p.distance_from_first_m != null || p.distance_from_recee_m != null;
                    return (
                      <View key={p.id} style={styles.signageRow}>
                        <AnnotatedImage
                          uri={p.photo_url}
                          annotation={p.annotation}
                          markerX={p.marker_x}
                          markerY={p.marker_y}
                          style={styles.photoWrap}
                        />
                        {hasDetails && (
                          <View style={styles.signageInfo}>
                            {p.signage_index != null && <Text style={styles.signageIdx}>Signage {p.signage_index}</Text>}
                            {p.signage_type && <Text style={styles.meta}>Type: {SIGNAGE_TYPE_LABELS[p.signage_type]}</Text>}
                            {p.boarding_size_label ? (
                              <Text style={styles.meta}>Size: {p.boarding_size_label}</Text>
                            ) : (p.custom_width_cm && p.custom_height_cm) ? (
                              <Text style={styles.meta}>Size: {cmToIn(p.custom_width_cm)}×{cmToIn(p.custom_height_cm)} in</Text>
                            ) : null}
                            {p.area_label && <Text style={styles.meta}>Area: {p.area_label}</Text>}
                            {p.brand_name && <Text style={styles.meta}>Brand: {p.brand_name}</Text>}
                            {p.distance_from_store_m != null && <Text style={styles.dist}>📍 {formatDistance(Number(p.distance_from_store_m))} from store</Text>}
                            {p.distance_from_recee_m != null && <Text style={styles.dist}>📍 {formatDistance(Number(p.distance_from_recee_m))} from 1st recee signage</Text>}
                            {p.distance_from_first_m != null && (
                              <Text style={styles.dist}>📍 {formatDistance(Number(p.distance_from_first_m))} from 1st {step.step_type === 'recee' ? 'signage' : 'installation photo'}</Text>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
              {step.boarding_size_label && <Text style={styles.meta}>Size: {step.boarding_size_label}</Text>}
              {(step.custom_width_cm && step.custom_height_cm) ? (
                <Text style={styles.meta}>Size: {cmToIn(step.custom_width_cm)} × {cmToIn(step.custom_height_cm)} in (custom)</Text>
              ) : null}
              {step.approval_status && (
                <Text style={[styles.meta, { color: step.approval_status === 'approved' ? colors.success : colors.danger }]}>
                  {step.approval_status === 'approved' ? 'Approved' : `Rejected: ${step.rejection_reason}`}
                </Text>
              )}
              {step.pamphlet_count != null && <Text style={styles.meta}>Pamphlets: {step.pamphlet_count}</Text>}
              {step.lat && <Text style={styles.meta}>📍 {parseFloat(String(step.lat)).toFixed(5)}, {parseFloat(String(step.long)).toFixed(5)}</Text>}
              {step.notes && <Text style={styles.notes}>{step.notes}</Text>}
            </Card>
          ))}
        </View>
      )}

      <View style={styles.actions}>{renderActions()}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, backgroundColor: colors.background },
  card: { marginBottom: spacing.md },
  type: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  store: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.sm },
  address: { fontSize: 14, color: colors.textSecondary },
  meta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  link: { fontSize: 14, color: colors.primary, marginTop: 4, fontWeight: '600' },
  directionsCard: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, borderColor: colors.primary, borderWidth: 1 },
  directionsTitle: { fontSize: 16, fontWeight: '700', color: colors.primary },
  directionsSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  coords: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  directionsArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  directionsArrowText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  stepCard: { marginBottom: spacing.sm },
  stepType: { fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 0.5 },
  stepBy: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginVertical: spacing.xs },
  signageList: { gap: spacing.sm, marginVertical: spacing.xs },
  signageRow: { flexDirection: 'row', gap: spacing.sm },
  signageInfo: { flex: 1 },
  signageIdx: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  dist: { fontSize: 12, color: colors.success, marginTop: 2 },
  photoWrap: { width: 90, height: 90, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: '100%' },
  pin: {
    position: 'absolute', width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.danger, borderWidth: 2, borderColor: '#fff',
    marginLeft: -7, marginTop: -7,
  },
  notes: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
  actions: { marginTop: spacing.md, gap: spacing.sm },
  error: { flex: 1, textAlign: 'center', color: colors.danger, marginTop: spacing.xl },
});
