// Presentational hero pieces for the login brand canvas — the React Native
// port of the design's `login-responsive.jsx` (Brand, WkbPill, Headline,
// SubCopy, KpiStrip, StatusRow, FooterLinks) plus the SVG hero background and
// the Netherlands map. Props-only; all data is threaded in from `login.tsx`.
//
// The NL map reuses the shared geometry/projection from `@bimdossier/map`
// (NL_PROVINCE_PATHS / NL_VIEWBOX / createNlProjection) — identical to the web
// `NetherlandsMap`, just rendered with react-native-svg instead of DOM SVG.
import {
  createNlProjection,
  NL_DEFAULT_ACCENT,
  NL_PROVINCE_PATHS,
  NL_VIEWBOX,
  type MapMarker,
} from '@bimdossier/map';
import { Fragment, useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

import { GridTexture } from '@/components/GridTexture';
import { brand, colors, fonts } from '@/theme';

// ── Hero background — blue gradient (SVG) + faint blueprint grid ────────────
export function HeroBackground({ gridStep = 30 }: { gridStep?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          {/* ~168° linear gradient → near-vertical with a slight lean. */}
          <SvgLinearGradient id="heroGrad" x1="0" y1="0" x2="0.18" y2="1">
            <Stop offset="0" stopColor={brand.gradient[0]} />
            <Stop offset="0.6" stopColor={brand.gradient[1]} />
            <Stop offset="1" stopColor={brand.gradient[2]} />
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGrad)" />
      </Svg>
      <GridTexture step={gridStep} color="rgba(255,255,255,0.09)" />
    </View>
  );
}

// ── Netherlands map silhouette + live project markers ──────────────────────
export interface NlMapProps {
  /** Rendered width in px; height derives from the native aspect ratio. */
  width: number;
  /** Province fill. */
  color?: string;
  /** Province seam stroke. */
  seam?: string;
  seamWidth?: number;
  /** Layer opacity (the design fades the map heavily on phones). */
  opacity?: number;
  /** Live project anchors (projected via the shared Mercator projection). */
  markers?: readonly MapMarker[];
}

export function NlMap({
  width,
  color = '#d7e3f3',
  seam = 'rgba(28,58,107,0.22)',
  seamWidth = 0.8,
  opacity = 1,
  markers,
}: NlMapProps) {
  const height = width * (NL_VIEWBOX.height / NL_VIEWBOX.width);
  const project = useMemo(
    () => createNlProjection(NL_VIEWBOX.width, NL_VIEWBOX.height),
    [],
  );
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${NL_VIEWBOX.width} ${NL_VIEWBOX.height}`}
      style={{ opacity }}
    >
      <G>
        {NL_PROVINCE_PATHS.map((d, i) => (
          <Path
            key={i}
            d={d}
            fill={color}
            stroke={seam}
            strokeWidth={seamWidth}
            strokeLinejoin="round"
          />
        ))}
      </G>
      {markers?.map((m, i) => {
        const [x, y] = project(m.lat, m.lng);
        const accent = m.accent ?? NL_DEFAULT_ACCENT;
        return (
          <Fragment key={`${m.lat}-${m.lng}-${i}`}>
            <Circle cx={x} cy={y} r={7} fill="#fff" stroke={accent} strokeWidth={2.2} />
            <Circle cx={x} cy={y} r={3} fill={accent} />
          </Fragment>
        );
      })}
    </Svg>
  );
}

// ── Brand lockup — "BD" mark + wordmark + uppercase subtext ─────────────────
export interface BrandProps {
  markSize?: number;
  nameSize?: number;
  subSize?: number;
  subText?: string | null;
}

export function Brand({ markSize = 34, nameSize = 17, subSize = 8, subText }: BrandProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: markSize,
          height: markSize,
          borderRadius: 7,
          backgroundColor: 'rgba(255,255,255,0.14)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.30)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: fonts.displaySemibold,
            color: brand.heroFg,
            fontSize: markSize * 0.42,
            letterSpacing: markSize * 0.42 * 0.02,
          }}
        >
          BD
        </Text>
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text
          style={{
            fontFamily: fonts.displaySemibold,
            color: brand.heroFg,
            fontSize: nameSize,
            letterSpacing: -nameSize * 0.01,
            lineHeight: nameSize * 1.05,
          }}
        >
          BimDossier
        </Text>
        {subText ? (
          <Text
            style={{
              fontSize: subSize,
              color: 'rgba(255,255,255,0.62)',
              letterSpacing: subSize * 0.1,
              textTransform: 'uppercase',
              fontWeight: '600',
              marginTop: 3,
              lineHeight: subSize * 1.3,
            }}
          >
            {subText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ── WKB readiness pill (mint) ───────────────────────────────────────────────
export function WkbPill({ fontSize = 9, text }: { fontSize?: number; text: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(127,224,168,0.13)',
        borderWidth: 1,
        borderColor: 'rgba(127,224,168,0.30)',
        borderRadius: 999,
        paddingVertical: 5,
        paddingHorizontal: 12,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: brand.mint }} />
      <Text
        style={{
          fontSize,
          color: brand.mint,
          letterSpacing: fontSize * 0.12,
          textTransform: 'uppercase',
          fontWeight: '700',
          lineHeight: fontSize * 1.2,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

// ── Hero headline (Fraunces, italic accent words) ──────────────────────────
export function Headline({ fontSize, lineHeight = 1.04 }: { fontSize: number; lineHeight?: number }) {
  const accent = { fontFamily: fonts.displayItalic, color: brand.accentBlue };
  return (
    <Text
      style={{
        fontFamily: fonts.display,
        color: brand.heroFg,
        fontSize,
        lineHeight: fontSize * lineHeight,
        letterSpacing: -fontSize * 0.02,
      }}
    >
      Stitch your <Text style={accent}>models</Text>, <Text style={accent}>issues</Text> and{' '}
      <Text style={accent}>dossier</Text> into one Quality Assurance in Construction Act (Wkb)
      record.
    </Text>
  );
}

export function SubCopy({ fontSize = 12.5, maxWidth }: { fontSize?: number; maxWidth?: number }) {
  return (
    <Text style={{ fontSize, color: 'rgba(255,255,255,0.74)', lineHeight: fontSize * 1.55, maxWidth }}>
      Federated IFC review, automated Bouwbesluit checks and a delivery-ready consumentendossier —
      for builders working under the Quality Assurance in Construction Act (Wkb).
    </Text>
  );
}

// ── KPI strip (values live from /public/system-status, with fallbacks) ──────
export interface Kpi {
  label: string;
  value: string;
  valueColor?: string;
}

export function KpiStrip({ items, scale = 1 }: { items: readonly Kpi[]; scale?: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.16)',
        paddingTop: 14 * scale,
      }}
    >
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <View
            key={it.label}
            style={{
              paddingRight: 22 * scale,
              marginRight: last ? 0 : 22 * scale,
              borderRightWidth: last ? 0 : 1,
              borderRightColor: 'rgba(255,255,255,0.12)',
            }}
          >
            <Text
              style={{
                fontSize: 8.5 * scale,
                color: 'rgba(255,255,255,0.55)',
                letterSpacing: 8.5 * scale * 0.12,
                textTransform: 'uppercase',
                fontWeight: '700',
              }}
            >
              {it.label}
            </Text>
            <Text
              style={{
                fontFamily: fonts.displaySemibold,
                fontSize: 17 * scale,
                color: it.valueColor ?? brand.heroFg,
                letterSpacing: -17 * scale * 0.01,
                lineHeight: 17 * scale * 1.1,
                marginTop: 2,
                fontVariant: ['tabular-nums'],
              }}
            >
              {it.value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Form-sheet status row ("● All systems normal" / "dev · local") ──────────
export function StatusRow({
  statusColor = colors.success,
  label = 'All systems normal',
  tail = 'dev · local',
}: {
  statusColor?: string;
  label?: string;
  tail?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
        <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{tail}</Text>
    </View>
  );
}

// ── Legal footer (links open the web portal) ────────────────────────────────
const LEGAL_LINKS: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/legal/privacy', label: 'Privacy policy' },
  { path: '/legal/terms', label: 'Terms of service' },
  { path: '/legal/dpa', label: 'DPA' },
];

export function FooterLinks({
  stacked = false,
  center = false,
  wkb = '2026.1',
  webBaseUrl,
}: {
  stacked?: boolean;
  center?: boolean;
  wkb?: string;
  webBaseUrl: string;
}) {
  return (
    <View
      style={{
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? (center ? 'center' : 'flex-start') : 'center',
        justifyContent: 'space-between',
        gap: stacked ? 8 : 0,
      }}
    >
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
        © 2026 BimDossier · Wkb {wkb}
      </Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        {LEGAL_LINKS.map((l) => (
          <Pressable
            key={l.path}
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            onPress={() => {
              void Linking.openURL(`${webBaseUrl}${l.path}`);
            }}
          >
            <Text style={{ fontSize: 11.5, color: colors.textSecondary }}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
