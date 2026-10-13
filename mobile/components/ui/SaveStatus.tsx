import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/theme';

/** Small "Saving… / Saved / Save failed" indicator for an autosaved form. */
export function SaveStatus({ state }: { state: 'idle' | 'saving' | 'saved' | 'failed' }) {
  if (state === 'idle') return null;
  const text = state === 'saving' ? 'Saving…' : state === 'saved' ? '✓ Draft saved' : '⚠ Could not save draft — keep this screen open';
  return <Text style={[styles.t, state === 'failed' && { color: colors.danger }]}>{text}</Text>;
}

const styles = StyleSheet.create({ t: { fontSize: 12, color: colors.textMuted, textAlign: 'right' } });
