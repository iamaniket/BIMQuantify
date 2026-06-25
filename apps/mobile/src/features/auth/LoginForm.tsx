// Presentational "Welcome back." sign-in form (the light sheet). All auth
// state + handlers are passed in from `login.tsx`; the only local state here is
// pure UI (which field is focused, the cosmetic remember-me toggle).
//
// Sizing follows iOS HIG / Android Material: inputs + primary button are 52 tall
// (≥48 dp), body text is 16, and every secondary control (eye toggle, checkbox,
// links) gets a ≥44/48 hit area via hitSlop or padding.
import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useT } from '@/i18n';
import { colors, fonts, radii } from '@/theme';

const FIELD_HEIGHT = 52;

export interface LoginFormProps {
  email: string;
  password: string;
  onChangeEmail: (v: string) => void;
  onChangePassword: (v: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  submitting: boolean;
  error: string | null;
  canSubmit: boolean;
  onSubmit: () => void;
  onForgot: () => void;
  onRequestAccess: () => void;
  /** Title size — drives the layout-specific scale (mobile 28 / tablet 32–34). */
  titleSize?: number;
}

function FieldLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: colors.textMuted,
        }}
      >
        {children}
      </Text>
      {action}
    </View>
  );
}

export function LoginForm({
  email,
  password,
  onChangeEmail,
  onChangePassword,
  showPassword,
  onToggleShow,
  submitting,
  error,
  canSubmit,
  onSubmit,
  onForgot,
  onRequestAccess,
  titleSize = 28,
}: LoginFormProps) {
  const { t } = useT();
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  const [remember, setRemember] = useState(true);

  return (
    <View style={{ width: '100%' }}>
      {/* Intro */}
      <View style={{ marginBottom: 22 }}>
        <Text
          style={{
            fontSize: 11,
            color: colors.primary,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            fontWeight: '700',
            marginBottom: 8,
          }}
        >
          {t('login.form.eyebrow')}
        </Text>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: titleSize,
            letterSpacing: -titleSize * 0.02,
            lineHeight: titleSize * 1.08,
            color: colors.text,
          }}
        >
          {t('login.form.title')}
        </Text>
        <Text style={{ fontSize: 13.5, color: colors.textMuted, marginTop: 9, lineHeight: 20 }}>
          {t('login.form.newHere')}
          <Text
            onPress={onRequestAccess}
            style={{ color: colors.primary, fontWeight: '600' }}
          >
            {t('login.form.requestAccess')}
          </Text>
        </Text>
      </View>

      {/* Fields */}
      <View style={{ gap: 16 }}>
        <View>
          <FieldLabel>{t('login.form.emailLabel')}</FieldLabel>
          <View style={[styles.inputRow, focused === 'email' && styles.inputRowFocused]}>
            <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              placeholder={t('login.form.emailPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              value={email}
              onChangeText={onChangeEmail}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              editable={!submitting}
            />
          </View>
        </View>

        <View>
          <FieldLabel
            action={
              <Pressable onPress={onForgot} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
                <Text style={{ fontSize: 11.5, color: colors.primary, fontWeight: '600' }}>
                  {t('login.form.forgot')}
                </Text>
              </Pressable>
            }
          >
            {t('login.form.passwordLabel')}
          </FieldLabel>
          <View style={[styles.inputRow, focused === 'password' && styles.inputRowFocused]}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.placeholder}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password"
              value={password}
              onChangeText={onChangePassword}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused(null)}
              editable={!submitting}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />
            <Pressable
              onPress={onToggleShow}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
          </View>
        </View>

        {/* Keep me signed in (cosmetic — tokens already persist securely) */}
        <Pressable
          onPress={() => setRemember((v) => !v)}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 }}
        >
          <View
            style={[
              styles.checkbox,
              {
                backgroundColor: remember ? colors.primary : colors.surface,
                borderColor: remember ? colors.primary : colors.border,
              },
            ]}
          >
            {remember ? <Ionicons name="checkmark" size={13} color={colors.onPrimary} /> : null}
          </View>
          <Text style={{ fontSize: 13.5, color: colors.textSecondary }}>
            {t('login.form.rememberMe')}
          </Text>
        </Pressable>

        {error !== null ? <Text style={styles.error}>{error}</Text> : null}

        {/* Sign in */}
        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
          style={({ pressed }) => [
            styles.button,
            pressed && canSubmit && styles.buttonPressed,
            !canSubmit && styles.buttonDisabled,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Text style={styles.buttonText}>{t('login.form.submit')}</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: FIELD_HEIGHT,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  inputRowFocused: { borderColor: colors.primary },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
    minWidth: 0,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: colors.error, fontSize: 13.5 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: FIELD_HEIGHT,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  buttonPressed: { backgroundColor: colors.primaryHover },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});
