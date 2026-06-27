import { Ionicons } from '@expo/vector-icons';
import { type DrawerContentComponentProps } from 'expo-router/drawer';
import { usePathname, useRouter } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { Avatar, initialsFrom } from '@/components/Avatar';
import { BlueGradient } from '@/components/BlueGradient';
import { BrandMark } from '@/components/BrandMark';
import { useProjects } from '@/features/projects/queries';
import { useAuth } from '@/providers/AuthProvider';
import { colors, fonts, radii } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const ON = colors.onPrimary;
const ON_SOFT = 'rgba(255,255,255,0.78)';
const ON_FAINT = 'rgba(255,255,255,0.55)';

/** Square tenant mark with initials — translucent on the card, solid in the dropdown. */
function TenantMark({ name, size = 32, dark = false }: { name: string; size?: number; dark?: boolean }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: 9,
          backgroundColor: dark ? colors.primary : 'rgba(255,255,255,0.16)',
          borderWidth: dark ? 0 : 1,
          borderColor: 'rgba(255,255,255,0.28)',
        },
        styles.center,
      ]}
    >
      <Text allowFontScaling={false} style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }}>
        {initialsFrom(name)}
      </Text>
    </View>
  );
}

/**
 * Custom drawer content — the design's `BlueSidebar`. Top-to-bottom: user row,
 * tenant switcher card, "Workspace" nav, footer actions (Settings / Sign out),
 * and the brand header pinned to the bottom. Blue gradient + blueprint grid.
 * Works unchanged as a slide-in (front) drawer and a docked (permanent) sidebar.
 */
export function AppSidebar(props: DrawerContentComponentProps) {
  const router = useRouter();
  const { t } = useT();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { me, activeMembership, switchOrganization, signOut } = useAuth();
  const { data: projects } = useProjects();

  const [switching, setSwitching] = useState<string | null>(null);
  const [tenantOpen, setTenantOpen] = useState(false);

  const memberships = me?.memberships ?? [];
  const otherOrgs = memberships.filter((m) => m.organization_id !== me?.active_organization_id);
  const single = memberships.length <= 1;
  const projectsCount = projects?.length ?? 0;
  const projectsActive = pathname.startsWith('/projects');

  function go(path: '/projects' | '/settings'): void {
    props.navigation.closeDrawer();
    router.navigate(path);
  }

  async function pickOrg(id: string): Promise<void> {
    setSwitching(id);
    try {
      await switchOrganization(id);
      setTenantOpen(false);
      props.navigation.closeDrawer();
    } catch {
      // Stay on the current org; the switch simply didn't take.
    } finally {
      setSwitching(null);
    }
  }

  const planLine =
    activeMembership == null
      ? ''
      : activeMembership.seat_limit != null
        ? t('nav.seatsLimit', { used: activeMembership.seat_count_used, limit: activeMembership.seat_limit })
        : t('nav.seats', { used: activeMembership.seat_count_used });

  return (
    <View style={styles.root}>
      <BlueGradient />

      {/* User + tenant (fixed top) */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 14 }}>
        <View style={styles.userRow}>
          <Avatar name={me?.user.full_name} email={me?.user.email} size={36} />
          <View style={styles.userText}>
            <Text style={styles.userName} numberOfLines={1}>
              {me?.user.full_name ?? me?.user.email ?? t('nav.signedIn')}
            </Text>
            <Text style={styles.userRoleText} numberOfLines={1}>
              {activeMembership?.is_org_admin ? t('nav.admin') : t('nav.member')}
            </Text>
          </View>
        </View>

        {activeMembership != null ? (
          <View style={styles.tenantWrap}>
            <Text style={styles.kicker}>{t('nav.tenant')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: tenantOpen, disabled: single }}
              disabled={single}
              onPress={() => setTenantOpen((v) => !v)}
              style={[styles.tenantBtn, tenantOpen ? styles.tenantBtnOpen : null]}
            >
              <TenantMark name={activeMembership.organization_name} />
              <View style={styles.tenantText}>
                <Text style={styles.tenantName} numberOfLines={1}>
                  {activeMembership.organization_name}
                </Text>
                {planLine.length > 0 ? (
                  <Text style={styles.tenantPlan} numberOfLines={1}>
                    {planLine}
                  </Text>
                ) : null}
              </View>
              <Ionicons
                name={single ? 'lock-closed' : tenantOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={ON_FAINT}
              />
            </Pressable>

            {tenantOpen && !single ? (
              <View style={styles.tenantList}>
                {otherOrgs.map((m) => (
                  <Pressable
                    key={m.organization_id}
                    accessibilityRole="button"
                    accessibilityLabel={t('nav.switchTo', { name: m.organization_name })}
                    disabled={switching !== null}
                    onPress={() => {
                      void pickOrg(m.organization_id);
                    }}
                    style={styles.tenantListItem}
                  >
                    <TenantMark name={m.organization_name} size={30} dark />
                    <View style={styles.tenantText}>
                      <Text style={styles.tenantListName} numberOfLines={1}>
                        {m.organization_name}
                      </Text>
                      <Text style={styles.tenantListPlan} numberOfLines={1}>
                        {m.seat_limit != null
                          ? t('nav.seatsLimit', { used: m.seat_count_used, limit: m.seat_limit })
                          : t('nav.seats', { used: m.seat_count_used })}
                      </Text>
                    </View>
                    {switching === m.organization_id ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Workspace nav (scrollable middle) */}
      <ScrollView style={styles.nav} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.kicker, styles.navKicker]}>{t('nav.workspace')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: projectsActive }}
          onPress={() => go('/projects')}
          style={[styles.navItem, projectsActive ? styles.navItemActive : null]}
        >
          {projectsActive ? <View style={styles.navActiveBar} /> : null}
          <Ionicons name="grid-outline" size={20} color={ON} />
          <Text style={styles.navLabel}>{t('nav.projects')}</Text>
          {projectsCount > 0 ? (
            <View style={[styles.navBadge, projectsActive ? styles.navBadgeActive : null]}>
              <Text style={[styles.navBadgeText, projectsActive ? styles.navBadgeTextActive : null]}>{projectsCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </ScrollView>

      {/* Footer actions + brand (fixed bottom) */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
        <FooterAction icon="settings-outline" label={t('nav.settings')} onPress={() => go('/settings')} />
        <FooterAction icon="log-out-outline" label={t('nav.signOut')} onPress={() => { void signOut(); }} />
        <View style={styles.brand}>
          <BrandMark size={34} variant="white" />
          <View style={styles.brandText}>
            <Text style={styles.wordmark}>BimDossier</Text>
            <Text style={styles.tagline}>{t('nav.brandTagline')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function FooterAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.footerAction}>
      <Ionicons name={icon} size={20} color={ON_SOFT} />
      <Text style={styles.footerActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  center: { alignItems: 'center', justifyContent: 'center' },

  // User row
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 10 },
  userText: { flex: 1, minWidth: 0 },
  userName: { fontSize: 14, fontWeight: '700', color: ON },
  userRoleText: { fontSize: 11, color: 'rgba(255,255,255,0.62)', marginTop: 1 },

  // Tenant switcher
  tenantWrap: { marginTop: 16 },
  kicker: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: ON_FAINT, textTransform: 'uppercase', paddingHorizontal: 4, paddingBottom: 7 },
  tenantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  tenantBtnOpen: { borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.18)' },
  tenantText: { flex: 1, minWidth: 0 },
  tenantName: { fontSize: 14, fontWeight: '700', color: ON },
  tenantPlan: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  tenantList: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
  },
  tenantListItem: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, paddingHorizontal: 10, borderRadius: radii.sm },
  tenantListName: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  tenantListPlan: { fontSize: 11, color: colors.textMuted, marginTop: 1 },

  // Nav
  nav: { flex: 1, marginTop: 14 },
  navContent: { paddingHorizontal: 12, paddingBottom: 12 },
  navKicker: { paddingHorizontal: 14 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 13, height: 46, paddingHorizontal: 14, borderRadius: radii.lg },
  navItemActive: { backgroundColor: 'rgba(255,255,255,0.16)' },
  navActiveBar: { position: 'absolute', left: 4, top: 11, bottom: 11, width: 3, borderRadius: 999, backgroundColor: '#fff' },
  navLabel: { flex: 1, fontSize: 14.5, fontWeight: '600', color: ON },
  navBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  navBadgeActive: { backgroundColor: '#fff' },
  navBadgeText: { fontSize: 10.5, fontWeight: '800', color: '#fff' },
  navBadgeTextActive: { color: colors.primary },

  // Footer
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 12, paddingTop: 8 },
  footerAction: { flexDirection: 'row', alignItems: 'center', gap: 13, height: 44, paddingHorizontal: 12, borderRadius: radii.lg },
  footerActionText: { fontSize: 14, fontWeight: '500', color: ON_SOFT },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 6, paddingTop: 14, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  brandText: { flex: 1, minWidth: 0 },
  wordmark: { fontFamily: fonts.displaySemibold, fontSize: 17, color: ON, letterSpacing: -0.2 },
  tagline: { fontSize: 9, fontWeight: '600', letterSpacing: 1.2, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', marginTop: 2 },
});
