import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { forgotPassword } from '../../services/auth.api';
import { apiError } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { colors, spacing, radius } from '../../constants/theme';

/**
 * Passwords can only be changed by an administrator. This files a request they
 * see on the web console; they set a new password and pass it on directly.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!email.trim()) { Alert.alert('Required', 'Enter your account email'); return; }
    setBusy(true);
    try {
      await forgotPassword(email.trim().toLowerCase(), name.trim(), mobile.trim());
      setSent(true);
    } catch (e: unknown) {
      Alert.alert('Could not send request', apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Forgot password</Text>
        {sent ? (
          <>
            <Text style={styles.note}>
              Your request has been sent to the administrator. They will contact you with a new password.
            </Text>
            <Button title="Back to sign in" onPress={() => router.replace('/(auth)/login')} style={styles.btn} />
          </>
        ) : (
          <>
            <Text style={styles.note}>
              Passwords are set by an administrator. Send a request and they will contact you with a new one.
            </Text>
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address"
              autoCapitalize="none" placeholder="you@example.com" placeholderTextColor={colors.textMuted} />
            <Text style={styles.label}>Your name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} autoCapitalize="words"
              placeholderTextColor={colors.textMuted} />
            <Text style={styles.label}>Mobile number</Text>
            <TextInput style={styles.input} value={mobile} onChangeText={setMobile} keyboardType="phone-pad"
              placeholderTextColor={colors.textMuted} />
            <Button title="Request new password" onPress={submit} loading={busy} style={styles.btn} />
            <TouchableOpacity onPress={() => router.back()} style={styles.back}>
              <Text style={styles.backText}>← Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  title: { fontSize: 26, fontWeight: '800', color: colors.primary, textAlign: 'center', marginBottom: spacing.sm },
  note: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm + 2,
    fontSize: 16, backgroundColor: colors.surface, color: colors.textPrimary,
  },
  btn: { marginTop: spacing.md },
  back: { marginTop: spacing.md, alignItems: 'center' },
  backText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
});
