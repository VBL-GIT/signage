import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { useAuthStore } from '../../store/auth.store';
import { apiError } from '../../services/api';
import { forgotPassword } from '../../services/auth.api';
import { Button } from '../../components/ui/Button';
import { colors, spacing, radius } from '../../constants/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const login = useAuthStore((s) => s.login);

  async function handleLogin() {
    if (!email || !password) { Alert.alert('Error', 'Enter email and password'); return; }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e: unknown) {
      Alert.alert('Login Failed', apiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email) { Alert.alert('Forgot Password', 'Enter your email above first, then tap "Forgot password?" again.'); return; }
    setResetting(true);
    try {
      await forgotPassword(email.trim().toLowerCase());
      Alert.alert('Check Your Email', 'If an account exists for that email, we\'ve sent a password reset link. Open it from your email app to set a new password, then come back and sign in.');
    } catch (e: unknown) {
      Alert.alert('Error', apiError(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Signage</Text>
        <Text style={styles.subtitle}>Field Operations</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
          />
          <Button title="Sign In" onPress={handleLogin} loading={loading} style={styles.btn} />
          <TouchableOpacity onPress={handleForgotPassword} disabled={resetting} style={styles.forgotLink}>
            <Text style={styles.forgotText}>{resetting ? 'Sending…' : 'Forgot password?'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  title: { fontSize: 36, fontWeight: '800', color: colors.primary, textAlign: 'center' },
  subtitle: { fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl * 2 },
  form: { gap: spacing.sm },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    fontSize: 16, backgroundColor: colors.surface, color: colors.textPrimary,
  },
  btn: { marginTop: spacing.md },
  forgotLink: { marginTop: spacing.md, alignItems: 'center' },
  forgotText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
});
