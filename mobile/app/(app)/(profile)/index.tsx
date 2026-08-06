import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useAuthStore } from '../../../store/auth.store';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ROLE_LABELS } from '../../../types/domain';
import { colors, spacing } from '../../../constants/theme';

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();

  function handleLogout() {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{user ? ROLE_LABELS[user.role] : ''}</Text>
      </Card>

      <Button title="Sign Out" onPress={handleLogout} variant="danger" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  card: { marginBottom: spacing.lg },
  name: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  email: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  role: {
    marginTop: spacing.sm, alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight, color: colors.primary,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: 12, fontSize: 13, fontWeight: '600',
    overflow: 'hidden',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { flex: 1, paddingRight: spacing.md },
  toggleTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  toggleHint: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
});
