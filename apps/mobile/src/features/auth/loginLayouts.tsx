// The three responsive login layouts (phone stacked / tablet portrait band /
// tablet landscape split), ported from the design's MobileLogin /
// TabletPortraitLogin / TabletLandscapeLogin. Each is presentational: it
// arranges the brand-canvas pieces + the LoginForm and receives all data
// (form props, live markers, KPI/status, safe-area insets) from `login.tsx`.
//
// Device chrome from the mock (fake status bar, home indicator) is dropped —
// the real OS supplies those; we pad by safe-area insets instead.
import { NL_ASPECT_RATIO, type MapMarker } from '@bimdossier/map';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  ScrollView,
  UIManager,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import type { EdgeInsets } from 'react-native-safe-area-context';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

import { useT } from '@/i18n';
import { brand, colors } from '@/theme';

import {
  Brand,
  FooterLinks,
  Headline,
  HeroBackground,
  type Kpi,
  KpiStrip,
  NlMap,
  StatusRow,
  SubCopy,
  WkbPill,
} from './brandParts';
import { LoginForm, type LoginFormProps } from './LoginForm';

const NL_ASPECT = 1 / NL_ASPECT_RATIO;

export interface LoginLayoutProps {
  form: LoginFormProps;
  markers: readonly MapMarker[];
  kpiItems: readonly Kpi[];
  statusColor: string;
  statusLabel: string;
  webBaseUrl: string;
  insets: EdgeInsets;
}

/**
 * Keyboard-aware vertical scroller. On iOS `automaticallyAdjustKeyboardInsets`
 * insets + scrolls the focused field above the keyboard; on Android the window
 * resizes (softwareKeyboardLayoutMode: "resize") and the ScrollView scrolls it
 * into view. `keyboardShouldPersistTaps` keeps buttons tappable while editing.
 */
function KbScroll({ children, contentStyle }: { children: ReactNode; contentStyle?: ViewStyle }) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ flexGrow: 1 }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      automaticallyAdjustKeyboardInsets
    >
      {children}
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE — stacked hero + overlapping form sheet
// ═══════════════════════════════════════════════════════════════════════════
export function MobileLogin({
  form,
  kpiItems,
  statusColor,
  statusLabel,
  webBaseUrl,
  insets,
}: LoginLayoutProps) {
  const { t } = useT();
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const anim = LayoutAnimation.create(
      250,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    );
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        LayoutAnimation.configureNext(anim);
        setKeyboardUp(true);
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        LayoutAnimation.configureNext(anim);
        setKeyboardUp(false);
      },
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <KbScroll>
      {/* HERO — collapses when keyboard is up so the form slides over it */}
      {!keyboardUp && (
        <View
          style={{
            backgroundColor: brand.gradient[0],
            overflow: 'hidden',
            paddingTop: insets.top + 14,
            paddingBottom: 34,
            paddingHorizontal: 26,
          }}
        >
          <HeroBackground gridStep={30} />
          <View pointerEvents="none" style={{ position: 'absolute', right: -86, bottom: -70, opacity: 0.28 }}>
            <NlMap width={330} color="#bcd1ee" seam="rgba(255,255,255,0.20)" seamWidth={0.7} />
          </View>
          <View>
            <Brand markSize={34} nameSize={17} subSize={8} subText={t('login.hero.subtext')} />
            <View style={{ marginTop: 22 }}>
              <WkbPill fontSize={9} text={t('login.hero.pillMobile')} />
            </View>
            <View style={{ marginTop: 16 }}>
              <Headline fontSize={29} lineHeight={1.06} />
            </View>
            <View style={{ marginTop: 14 }}>
              <KpiStrip items={kpiItems} scale={0.96} />
            </View>
          </View>
        </View>
      )}

      {/* FORM SHEET — slides up over the hero area when keyboard opens */}
      <View
        style={{
          flexGrow: 1,
          backgroundColor: brand.surfacePage,
          marginTop: keyboardUp ? 0 : -18,
          borderTopLeftRadius: keyboardUp ? 0 : 22,
          borderTopRightRadius: keyboardUp ? 0 : 22,
          paddingHorizontal: 26,
          paddingTop: keyboardUp ? insets.top + 16 : 24,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <StatusRow statusColor={statusColor} label={statusLabel} />
        <View style={{ marginTop: 18 }}>
          <LoginForm {...form} titleSize={28} />
        </View>
        <View style={{ flex: 1, minHeight: 18 }} />
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 }}>
          <FooterLinks stacked center webBaseUrl={webBaseUrl} />
        </View>
      </View>
    </KbScroll>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLET — portrait: hero band on top + centered form
// ═══════════════════════════════════════════════════════════════════════════
export function TabletPortraitLogin({
  form,
  markers,
  kpiItems,
  statusColor,
  statusLabel,
  webBaseUrl,
  insets,
}: LoginLayoutProps) {
  const { t } = useT();
  const { height } = useWindowDimensions();
  const heroHeight = Math.round(height * 0.5);
  const mapWidth = 300;
  const mapTop = Math.round((heroHeight - mapWidth * NL_ASPECT) / 2);

  return (
    <KbScroll>
      <View
        style={{
          height: heroHeight,
          backgroundColor: brand.gradient[0],
          overflow: 'hidden',
          paddingTop: insets.top + 10,
          paddingHorizontal: 40,
        }}
      >
        <HeroBackground gridStep={36} />
        <View pointerEvents="none" style={{ position: 'absolute', right: 26, top: mapTop, opacity: 0.92 }}>
          <NlMap width={mapWidth} color="#d2e0f3" seam="rgba(28,58,107,0.20)" seamWidth={0.7} markers={markers} />
        </View>
        <View style={{ flex: 1, paddingBottom: 26 }}>
          <Brand markSize={36} nameSize={19} subSize={8.5} subText={t('login.hero.subtextTablet')} />
          <View style={{ marginTop: 26 }}>
            <WkbPill fontSize={9.5} text={t('login.hero.pillTablet')} />
          </View>
          <View style={{ marginTop: 20, maxWidth: 440 }}>
            <Headline fontSize={40} lineHeight={1.05} />
          </View>
          <View style={{ marginTop: 18, maxWidth: 420 }}>
            <SubCopy fontSize={13} />
          </View>
          <View style={{ marginTop: 'auto', maxWidth: 460 }}>
            <KpiStrip items={kpiItems} scale={1.05} />
          </View>
        </View>
      </View>

      <View
        style={{
          flexGrow: 1,
          backgroundColor: brand.surfacePage,
          paddingHorizontal: 40,
          paddingTop: 24,
          paddingBottom: insets.bottom + 18,
        }}
      >
        <StatusRow statusColor={statusColor} label={statusLabel} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 }}>
          <View style={{ width: 400, maxWidth: '100%' }}>
            <LoginForm {...form} titleSize={34} />
          </View>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 }}>
          <FooterLinks webBaseUrl={webBaseUrl} />
        </View>
      </View>
    </KbScroll>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLET — landscape: brand canvas (left) + form pane (right)
// ═══════════════════════════════════════════════════════════════════════════
export function TabletLandscapeLogin({
  form,
  markers,
  kpiItems,
  statusColor,
  statusLabel,
  webBaseUrl,
  insets,
}: LoginLayoutProps) {
  const { t } = useT();
  const { height } = useWindowDimensions();
  const mapWidth = Math.round(height * 0.6);

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {/* LEFT — brand canvas (fixed; decorative) */}
      <View
        style={{
          flex: 0.55,
          backgroundColor: brand.gradient[0],
          overflow: 'hidden',
          paddingTop: insets.top + 28,
          paddingBottom: insets.bottom + 28,
          paddingLeft: insets.left + 36,
          paddingRight: 36,
        }}
      >
        <HeroBackground gridStep={36} />
        <View
          pointerEvents="none"
          style={{ position: 'absolute', right: 24, top: 0, bottom: 0, justifyContent: 'center', opacity: 0.95 }}
        >
          <NlMap width={mapWidth} color="#d4e1f2" seam="rgba(28,58,107,0.20)" seamWidth={0.7} markers={markers} />
        </View>
        <Brand markSize={36} nameSize={19} subSize={8.5} subText={t('login.hero.subtextTablet')} />
        <View style={{ marginTop: 26 }}>
          <WkbPill fontSize={9.5} text={t('login.hero.pillTablet')} />
        </View>
        <View style={{ marginTop: 18, maxWidth: 420 }}>
          <Headline fontSize={42} lineHeight={1.03} />
        </View>
        <View style={{ marginTop: 18, maxWidth: 360 }}>
          <SubCopy fontSize={13} />
        </View>
        <View style={{ marginTop: 'auto', maxWidth: 460 }}>
          <KpiStrip items={kpiItems} scale={1.05} />
        </View>
      </View>

      {/* RIGHT — form pane (scrolls / keyboard-aware) */}
      <View style={{ flex: 0.45, backgroundColor: brand.surfacePage }}>
        <KbScroll
          contentStyle={{
            paddingTop: insets.top + 26,
            paddingBottom: insets.bottom + 26,
            paddingLeft: 44,
            paddingRight: insets.right + 44,
          }}
        >
          <StatusRow statusColor={statusColor} label={statusLabel} />
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24 }}>
            <View style={{ width: 360, maxWidth: '100%' }}>
              <LoginForm {...form} titleSize={32} />
            </View>
          </View>
          <FooterLinks webBaseUrl={webBaseUrl} />
        </KbScroll>
      </View>
    </View>
  );
}
