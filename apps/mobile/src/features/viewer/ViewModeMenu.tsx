import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '@/i18n';
import { colors, radii } from '@/theme';
import type { ViewMode } from '@/features/viewer/embedBridge';

type Option = { mode: ViewMode; label: string; icon: keyof typeof Ionicons.glyphMap };

const OPTIONS: Option[] = [
  { mode: '3d', label: '3D', icon: 'cube-outline' },
  { mode: '2d', label: '2D', icon: 'map-outline' },
  { mode: 'split', label: 'Split', icon: 'contrast-outline' },
];

type Props = {
  mode: ViewMode;
  /** 2D + Split are disabled when the model has no generated floor plans. */
  floorPlansAvailable: boolean;
  /** Which modes to offer. Defaults to all three; pass a subset to hide e.g. Split. */
  modes?: ViewMode[];
  onChange: (mode: ViewMode) => void;
};

/**
 * Header-right view switcher (3D / 2D / Split). RN has no native dropdown, so a
 * transparent Modal hosts the menu; the trigger is measured on open so the menu
 * anchors just below it on any device. Mirrors the embed's `ViewMode` and drives
 * it over the WebView bridge (`setViewMode`).
 */
export function ViewModeMenu({ mode, floorPlansAvailable, modes, onChange }: Props) {
  const { t } = useT();
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number }>({ top: 56, right: 12 });

  const options = modes ? OPTIONS.filter((o) => modes.includes(o.mode)) : OPTIONS;
  const current = options.find((o) => o.mode === mode) ?? options[0] ?? OPTIONS[0];

  const openMenu = (): void => {
    const node = triggerRef.current;
    if (node) {
      node.measureInWindow((x, y, w, h) => {
        setAnchor({ top: y + h + 6, right: Dimensions.get('window').width - (x + w) });
        setOpen(true);
      });
    } else {
      setOpen(true);
    }
  };

  return (
    <>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={t('projects.viewMode.changeViewA11y')}
        onPress={openMenu}
        hitSlop={10}
        style={styles.trigger}
      >
        <Ionicons name={current.icon} size={16} color={colors.onPrimary} />
        <Text style={styles.triggerText}>{current.label}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.onPrimary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => { setOpen(false); }}>
        <Pressable style={styles.backdrop} onPress={() => { setOpen(false); }}>
          <View style={[styles.menu, { top: anchor.top, right: anchor.right }]}>
            {options.map((o) => {
              const disabled = o.mode !== '3d' && !floorPlansAvailable;
              const selected = o.mode === mode;
              return (
                <Pressable
                  key={o.mode}
                  disabled={disabled}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected, disabled }}
                  onPress={() => {
                    setOpen(false);
                    if (o.mode !== mode) onChange(o.mode);
                  }}
                  style={({ pressed }) => [
                    styles.item,
                    selected ? styles.itemSelected : null,
                    pressed && !disabled ? styles.itemPressed : null,
                  ]}
                >
                  <Ionicons
                    name={o.icon}
                    size={18}
                    color={disabled ? colors.placeholder : selected ? colors.primary : colors.text}
                  />
                  <Text
                    style={[
                      styles.itemText,
                      disabled ? styles.itemTextDisabled : null,
                      selected ? styles.itemTextSelected : null,
                    ]}
                  >
                    {o.label}
                  </Text>
                  {selected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
            {!floorPlansAvailable ? (
              <Text style={styles.hint}>{t('projects.viewMode.noFloorPlan')}</Text>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
  },
  triggerText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    minWidth: 168,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  itemSelected: { backgroundColor: colors.primaryLight },
  itemPressed: { backgroundColor: colors.surfaceLow },
  itemText: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' },
  itemTextSelected: { color: colors.primary, fontWeight: '700' },
  itemTextDisabled: { color: colors.placeholder },
  hint: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
});
