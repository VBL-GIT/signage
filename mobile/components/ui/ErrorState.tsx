import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from './Button';
import { colors, spacing } from '../../constants/theme';

interface Props {
  message: string;
  onRetry?: () => void;
}

/** Inline error shown when a screen fails to load data (as opposed to a submit failure, which uses Alert). */
export function ErrorState({ message, onRetry }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && <Button title="Try Again" onPress={onRetry} variant="secondary" style={styles.btn} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  icon: { fontSize: 32 },
  message: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  btn: { marginTop: spacing.sm, minWidth: 140 },
});
