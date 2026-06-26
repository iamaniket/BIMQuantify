import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useT } from '@/i18n';
import { colors, radii } from '@/theme';

type Props = {
  visible: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (deadlineDate: string) => void;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days/months from today as a YYYY-MM-DD string (runtime new Date() is fine in
 * the app — the Date restriction only applies to workflow scripts). */
function fromToday(days: number, months = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

/**
 * Promote a draft finding to `open`. The server requires a deadline + assignee;
 * here the deadline is picked (quick chips or a typed YYYY-MM-DD) and the finding
 * self-assigns to the current user. A pure-JS date entry avoids adding the native
 * datetime-picker module (which would force an EAS dev-client rebuild).
 */
export function PromoteSheet({ visible, pending, onCancel, onSubmit }: Props) {
  const { t } = useT();
  const [date, setDate] = useState('');

  const handleSubmit = (): void => {
    if (!date.trim()) {
      Alert.alert(t('findings.promote.title'), t('findings.promote.deadlineRequired'));
      return;
    }
    if (!isValidIsoDate(date.trim())) {
      Alert.alert(t('findings.promote.title'), t('findings.promote.invalidDate'));
      return;
    }
    onSubmit(date.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('findings.promote.title')}</Text>
          <Text style={styles.hint}>{t('findings.promote.hint')}</Text>

          <Text style={styles.label}>{t('findings.promote.deadlineLabel')}</Text>
          <View style={styles.chips}>
            <QuickChip label={t('findings.promote.quick1w')} onPress={() => { setDate(fromToday(7)); }} active={date === fromToday(7)} />
            <QuickChip label={t('findings.promote.quick2w')} onPress={() => { setDate(fromToday(14)); }} active={date === fromToday(14)} />
            <QuickChip label={t('findings.promote.quick1m')} onPress={() => { setDate(fromToday(0, 1)); }} active={date === fromToday(0, 1)} />
          </View>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder={t('findings.promote.customDate')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <Text style={styles.assignNote}>{t('findings.promote.assignedToYou')}</Text>

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={pending}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.submitBtn, pending && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={pending}
            >
              {pending ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <Text style={styles.submitText}>{t('findings.promote.submit')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function QuickChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: 20,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  hint: { fontSize: 13, color: colors.textMuted },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginTop: 4 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  chipTextActive: { color: colors.onPrimary },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  assignNote: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  submitBtn: {
    flex: 2,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
