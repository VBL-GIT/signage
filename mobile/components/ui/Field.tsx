import React from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardTypeOptions, Pressable } from 'react-native';
import { colors, radius, spacing } from '../../constants/theme';

interface Props {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize, secureTextEntry }: Props) {
  // Any secure field gets a Show/Hide toggle — a typo in a masked box on a phone
  // keyboard is otherwise invisible until the login fails. Starts masked, and is
  // masked again on every remount: revealing is deliberate, never remembered.
  const [shown, setShown] = React.useState(false);
  const masked = !!secureTextEntry && !shown;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <TextInput
          style={[styles.input, secureTextEntry && styles.inputWithToggle]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={masked}
        />
        {secureTextEntry && (
          <Pressable
            onPress={() => setShown((v) => !v)}
            style={styles.toggle}
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            accessibilityState={{ selected: shown }}
            // Generous touch target: the visible text is small.
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.toggleText}>{shown ? 'Hide' : 'Show'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    fontSize: 16, backgroundColor: colors.surface, color: colors.textPrimary,
  },
  // Keep the text clear of the toggle so a long password is never hidden by it.
  inputWithToggle: { paddingRight: 64 },
  toggle: {
    position: 'absolute', right: spacing.sm, top: 0, bottom: 0,
    justifyContent: 'center', paddingHorizontal: spacing.xs,
  },
  toggleText: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
