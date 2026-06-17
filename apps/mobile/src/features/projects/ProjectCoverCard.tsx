import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { BlueGradient } from '@/components/BlueGradient';
import { isWithinNetherlands, pdokAerialThumbnailUrl } from '@/features/jurisdictions/nl/mapThumbnail';
import type { Project } from '@/lib/api/schemas/projects';
import { formatShortDate, humanize } from '@/lib/format';
import { colors, projectStatusColor, radii } from '@/theme';

const ON_SOFT = 'rgba(255,255,255,0.78)';
const ON_FAINT = 'rgba(255,255,255,0.6)';

function FootMeta({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.footMeta}>
      <Ionicons name={icon} size={12} color={ON_FAINT} />
      <Text style={styles.footMetaText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Full cover card for tablets (design `PCard`): a cover block (thumbnail or icon)
 * with a status pill, over a blue footer carrying the name, location, discipline
 * and a created/updated/delivery meta row.
 */
export function ProjectCoverCard({ project }: { project: Project }) {
  const router = useRouter();
  const hasCover = project.thumbnail_url != null && project.thumbnail_url !== '';

  // Aerial-photo fallback (PDOK, NL only) when no thumbnail — mirrors the portal
  // card. onError flags fall back if a presigned URL expires; effects reset them
  // when the source changes so a fresh URL after refetch loads.
  const [thumbFailed, setThumbFailed] = useState(false);
  const [aerialFailed, setAerialFailed] = useState(false);
  useEffect(() => { setThumbFailed(false); }, [project.thumbnail_url]);
  useEffect(() => { setAerialFailed(false); }, [project.latitude, project.longitude]);

  const showThumb = hasCover && !thumbFailed;
  const aerialUrl =
    !showThumb
    && project.latitude != null
    && project.longitude != null
    && isWithinNetherlands(project.latitude, project.longitude)
    && !aerialFailed
      ? pdokAerialThumbnailUrl(project.latitude, project.longitude, { width: 480, height: 264 })
      : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open project ${project.name}`}
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: '/projects/[projectId]',
          params: { projectId: project.id, name: project.name },
        })
      }
    >
      {/* cover */}
      <View style={styles.cover}>
        {showThumb ? (
          <Image
            source={{ uri: project.thumbnail_url! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
            onError={() => setThumbFailed(true)}
          />
        ) : aerialUrl != null ? (
          <Image
            source={{ uri: aerialUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
            onError={() => setAerialFailed(true)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.coverIcons]}>
            <Ionicons name="business-outline" size={34} color={colors.placeholder} />
            <Ionicons name="layers-outline" size={26} color={colors.placeholder} />
            <Ionicons name="create-outline" size={26} color={colors.placeholder} />
          </View>
        )}
        <View style={styles.statusPill}>
          <View style={[styles.dot, { backgroundColor: projectStatusColor(project.status) }]} />
          <Text style={styles.statusPillText}>{humanize(project.status)}</Text>
        </View>
        <View style={styles.dotsBtn}>
          <Ionicons name="ellipsis-horizontal" size={16} color="#fff" />
        </View>
      </View>

      {/* blue footer */}
      <View style={styles.footer}>
        <BlueGradient />
        <View style={styles.footerInner}>
          <View style={styles.footerTop}>
            <Text style={styles.name} numberOfLines={2}>
              {project.name}
            </Text>
            {project.city != null && project.city !== '' ? (
              <View style={styles.location}>
                <Ionicons name="location-outline" size={13} color={ON_FAINT} />
                <Text style={styles.locationText} numberOfLines={1}>
                  {project.city}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.disciplineRow}>
            <Ionicons name="layers-outline" size={13} color={ON_FAINT} />
            <Text style={styles.discipline}>{project.phase ? humanize(project.phase) : '—'}</Text>
            {project.reference_code != null && project.reference_code !== '' ? (
              <Text style={styles.note}>· {project.reference_code}</Text>
            ) : null}
          </View>

          <View style={styles.divider} />

          <View style={styles.footerBottom}>
            <View style={styles.metaGroup}>
              <FootMeta icon="calendar-outline" label={formatShortDate(project.created_at)} />
              <FootMeta icon="refresh-outline" label={formatShortDate(project.updated_at)} />
              <FootMeta icon="cube-outline" label={formatShortDate(project.delivery_date)} />
            </View>
            <Avatar name={project.name} size={24} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cover: { height: 132, position: 'relative', backgroundColor: colors.surfaceLow },
  coverIcons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  statusPill: {
    position: 'absolute',
    top: 9,
    left: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(15,23,42,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  statusPillText: { color: '#dbe6f7', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotsBtn: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { position: 'relative', backgroundColor: colors.primary },
  footerInner: { padding: 13, gap: 8 },
  footerTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  name: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2, lineHeight: 19 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 2 },
  locationText: { color: 'rgba(255,255,255,0.82)', fontSize: 11 },
  disciplineRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  discipline: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '500' },
  note: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.16)', marginTop: 4 },
  footerBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metaGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  footMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footMetaText: { color: ON_SOFT, fontSize: 10.5 },
});
