import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { BlueGradient } from '@/components/BlueGradient';
import { GridTexture } from '@/components/GridTexture';
import { isWithinNetherlands, pdokAerialThumbnailUrl } from '@/features/jurisdictions/nl/mapThumbnail';
import type { Project } from '@/lib/api/schemas/projects';
import { formatShortDate, humanize } from '@/lib/format';
import { colors, projectPhaseColor, radii } from '@/theme';

const ON_STRONG = 'rgba(255,255,255,0.92)';
const ON_SOFT = 'rgba(255,255,255,0.7)';

/**
 * Cover thumbnail: real thumbnail when present, else a PDOK aerial photo of the
 * project location (NL only), else a building glyph — mirrors the portal card.
 * `onError` falls back if a presigned thumbnail URL expires; the effects reset
 * the failed flags when the source changes so a fresh URL after refetch loads.
 */
function CoverThumb({ thumbnailUrl, aerialUrl }: { thumbnailUrl?: string | null; aerialUrl: string | null }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [aerialFailed, setAerialFailed] = useState(false);
  useEffect(() => { setThumbFailed(false); }, [thumbnailUrl]);
  useEffect(() => { setAerialFailed(false); }, [aerialUrl]);

  const showThumb = thumbnailUrl != null && thumbnailUrl !== '' && !thumbFailed;
  if (showThumb) {
    return (
      <Image
        source={{ uri: thumbnailUrl }}
        style={styles.thumb}
        contentFit="cover"
        transition={120}
        onError={() => setThumbFailed(true)}
      />
    );
  }
  if (aerialUrl != null && !aerialFailed) {
    return (
      <Image
        source={{ uri: aerialUrl }}
        style={styles.thumb}
        contentFit="cover"
        transition={120}
        onError={() => setAerialFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.thumb, styles.thumbIcon]}>
      <Ionicons name="business-outline" size={26} color="rgba(255,255,255,0.55)" />
    </View>
  );
}

/**
 * Compact list-style project card for phones (design `PCardCompact`): a blue
 * gradient row with a cover thumb, name, "phase · city", a status chip and the
 * delivery date, plus a project mark.
 */
export function ProjectCard({ project }: { project: Project }) {
  const router = useRouter();
  const sub = [project.phase ? humanize(project.phase) : null, project.city]
    .filter((x) => x != null && x !== '')
    .join(' · ');

  const hasThumb = project.thumbnail_url != null && project.thumbnail_url !== '';
  const aerialUrl =
    !hasThumb
    && project.latitude != null
    && project.longitude != null
    && isWithinNetherlands(project.latitude, project.longitude)
      ? pdokAerialThumbnailUrl(project.latitude, project.longitude)
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
      <BlueGradient style={styles.cardBg} />
      <GridTexture step={18} />
      <CoverThumb thumbnailUrl={project.thumbnail_url} aerialUrl={aerialUrl} />

      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={styles.nameWrap}>
            <Text style={styles.name} numberOfLines={1}>
              {project.name}
            </Text>
            {sub.length > 0 ? (
              <Text style={styles.sub} numberOfLines={1}>
                {sub}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.chip}>
            <View style={[styles.dot, { backgroundColor: projectPhaseColor(project.phase ?? '') }]} />
            <Text style={styles.chipText}>{humanize(project.phase ?? '')}</Text>
          </View>
          {project.delivery_date != null && project.delivery_date !== '' ? (
            <View style={styles.deliveryWrap}>
              <Ionicons name="calendar-outline" size={12} color={ON_SOFT} />
              <Text style={styles.delivery}>{formatShortDate(project.delivery_date)}</Text>
            </View>
          ) : null}
          <View style={styles.spacer} />
          <Avatar name={project.name} size={22} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    padding: 8,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
    backgroundColor: colors.primary,
  },
  cardBg: { borderRadius: radii.lg },
  thumb: { aspectRatio: 6 / 4, borderRadius: radii.md, overflow: 'hidden', alignSelf: 'stretch' },
  thumbIcon: { backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, justifyContent: 'space-between', gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  sub: { color: ON_SOFT, fontSize: 12, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  deliveryWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  delivery: { color: ON_STRONG, fontSize: 11 },
  spacer: { flex: 1 },
});
