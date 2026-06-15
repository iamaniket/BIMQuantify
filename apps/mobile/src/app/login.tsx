import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GridTexture } from '@/components/GridTexture';
import { login } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { env } from '@/lib/env';
import { useAuth } from '@/providers/AuthProvider';
import { colors, radii } from '@/theme';

const ICON = require('../../assets/images/icon.png');

export default function LoginScreen() {
  const router = useRouter();
  const { setTokens } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const pair = await login(email.trim(), password);
      setTokens(pair);
      // The index gate re-evaluates auth state and routes onward (or to org select).
      router.replace('/');
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 400
          ? 'Invalid email or password.'
          : `Sign in failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Primary blueprint grid — the brand texture, tinted for a light surface. */}
      <GridTexture step={28} color="rgba(44,86,151,0.12)" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <View style={styles.brand}>
            <View style={styles.logoTile}>
              <Image source={ICON} style={styles.logoImg} contentFit="cover" />
            </View>
            <Text style={styles.wordmark}>BimDossier</Text>
            <Text style={styles.tagline}>Field snagging & BIM dossiers</Text>
          </View>

          <View style={styles.form}>
            <View
              style={[styles.inputRow, focused === 'email' && styles.inputRowFocused]}
            >
              <Ionicons name="mail-outline" size={20} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocused('email')}
                onBlur={() => setFocused(null)}
                editable={!submitting}
              />
            </View>

            <View
              style={[styles.inputRow, focused === 'password' && styles.inputRowFocused]}
            >
              <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.placeholder}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password"
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                editable={!submitting}
                onSubmitEditing={() => {
                  void onSubmit();
                }}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textMuted}
                />
              </Pressable>
            </View>

            {error !== null ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && canSubmit && styles.buttonPressed,
                !canSubmit && styles.buttonDisabled,
              ]}
              onPress={() => {
                void onSubmit();
              }}
              disabled={!canSubmit}
            >
              {submitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </Pressable>
          </View>

          {__DEV__ ? <Text style={styles.debug}>API: {env.EXPO_PUBLIC_API_URL}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 28,
    paddingHorizontal: 24,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  brand: { alignItems: 'center', gap: 12 },
  logoTile: {
    width: 88,
    height: 88,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  logoImg: { width: '100%', height: '100%' },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.text,
  },
  tagline: { fontSize: 13, color: colors.textMuted },
  form: { gap: 14 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  inputRowFocused: { borderColor: colors.primary },
  input: { flex: 1, paddingVertical: 13, fontSize: 16, color: colors.text },
  error: { color: colors.error, fontSize: 14 },
  button: {
    marginTop: 4,
    paddingVertical: 15,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  buttonPressed: { backgroundColor: colors.primaryHover },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  debug: { fontSize: 11, color: colors.placeholder, textAlign: 'center' },
});
