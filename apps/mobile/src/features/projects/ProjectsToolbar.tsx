import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useT } from '@/i18n';
import { colors, radii } from '@/theme';

interface Props {
  query: string;
  onQueryChange: (next: string) => void;
  /** When true, only non-archived projects are shown. */
  activeOnly: boolean;
  onToggleActiveOnly: () => void;
  /** Count shown in the filter badge (visible projects under the current filter). */
  count: number;
  /** Landscape tablet shows a primary "New project" button. */
  showNew?: boolean;
  onNew?: () => void;
}

/**
 * Search + filter toolbar (design `Toolbar`). Search filters the list live by
 * name / city / reference; the filter button toggles All ⇄ Active-only and the
 * badge reflects the current visible count.
 */
export function ProjectsToolbar({
  query,
  onQueryChange,
  activeOnly,
  onToggleActiveOnly,
  count,
  showNew = false,
  onNew,
}: Props) {
  const { t } = useT();
  return (
    <View style={styles.row}>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.placeholder} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={onQueryChange}
          placeholder={t('projects.toolbar.searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={activeOnly ? t('projects.toolbar.showAllA11y') : t('projects.toolbar.showActiveA11y')}
        accessibilityState={{ selected: activeOnly }}
        style={[styles.filter, activeOnly ? styles.filterOn : null]}
        onPress={onToggleActiveOnly}
      >
        <Ionicons name="funnel-outline" size={14} color={activeOnly ? colors.primary : colors.textMuted} />
        <Text style={[styles.filterText, activeOnly ? styles.filterTextOn : null]}>
          {activeOnly ? t('projects.toolbar.filterActive') : t('projects.toolbar.filterAll')}
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      </Pressable>

      {showNew ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('projects.toolbar.newProjectA11y')} style={styles.new} onPress={onNew}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newText}>{t('projects.toolbar.newProject')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
  },
  input: { flex: 1, fontSize: 14, color: colors.text, padding: 0 },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 42,
    paddingHorizontal: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
  },
  filterOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  filterTextOn: { color: colors.primary },
  badge: {
    minWidth: 18,
    paddingHorizontal: 6,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10.5, fontWeight: '700', color: colors.primary },
  new: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 42,
    paddingHorizontal: 16,
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
  },
  newText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
});
