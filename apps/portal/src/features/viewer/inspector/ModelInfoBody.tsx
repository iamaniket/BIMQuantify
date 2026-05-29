'use client';

import { Eyebrow } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { PropertySetGroup } from '@/features/viewer/properties/PropertySetGroup';
import type { ModelMetadata, PropertySet, SpatialNode } from '@/lib/api/viewerTypes';

type ModelInfoBodyProps = {
  metadata: ModelMetadata | undefined;
  isLoading: boolean;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The spatial structure (project / site / building / storey / space) — the
 * high-level entities that carry metadata but have no geometry to click in the
 * 3D scene, so this read-only tree is the only place to inspect them. */
function SpatialRows({ node, depth }: { node: SpatialNode; depth: number }): JSX.Element {
  return (
    <>
      <div
        className="grid min-h-[30px] select-text items-center gap-2.5 border-l-2 border-transparent pr-2.5 transition-colors hover:bg-background-hover"
        style={{ paddingLeft: `${10 + depth * 14}px`, gridTemplateColumns: 'auto 1fr' }}
      >
        <Eyebrow size="sm" title={node.type} className="shrink-0 tracking-[0.04em]">
          {node.type}
        </Eyebrow>
        <span className="truncate font-sans text-micro leading-tight text-foreground">
          {node.name ?? '—'}
        </span>
      </div>
      {node.children.map((child) => (
        <SpatialRows key={child.expressID} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function ModelInfoBody({ metadata, isLoading }: ModelInfoBodyProps): JSX.Element {
  const t = useTranslations('viewerModelInfo');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const modelProps = useMemo<PropertySet>(() => {
    if (!metadata) return {};
    const props: PropertySet = {
      [t('schema')]: metadata.schema,
      [t('sourceFormat')]: metadata.source_format,
      [t('project')]: metadata.project.name ?? '—',
    };
    if (metadata.project.longName !== null) props[t('longName')] = metadata.project.longName;
    if (metadata.project.lengthUnit !== null) props[t('lengthUnit')] = metadata.project.lengthUnit;
    props[t('totalElements')] = metadata.totalElements;
    return props;
  }, [metadata, t]);

  const classCounts = useMemo<PropertySet>(() => {
    if (!metadata) return {};
    const entries = Object.entries(metadata.elementCounts).sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(entries);
  }, [metadata]);

  const bboxProps = useMemo<PropertySet | null>(() => {
    if (!metadata?.bbox) return null;
    const { min, max } = metadata.bbox;
    return {
      [t('width')]: round2(max[0] - min[0]),
      [t('depth')]: round2(max[1] - min[1]),
      [t('height')]: round2(max[2] - min[2]),
    };
  }, [metadata, t]);

  if (isLoading) {
    return <PanelEmptyState message={t('loading')} />;
  }
  if (!metadata) {
    return <PanelEmptyState message={t('unavailable')} />;
  }

  const toggle = (name: string): void => {
    setOpenGroups((o) => ({ ...o, [name]: !(o[name] ?? true) }));
  };

  const modelTitle = t('sectionModel');
  const classTitle = t('sectionClasses');
  const bboxTitle = t('sectionBbox');

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="min-h-0 flex-1 overflow-auto">
        <PropertySetGroup
          name={modelTitle}
          properties={modelProps}
          open={openGroups[modelTitle] ?? true}
          onToggle={() => { toggle(modelTitle); }}
        />

        {metadata.spatialTree !== null && (
          <div className="border-t border-border">
            <div className="flex h-[30px] items-center gap-2 pl-2 pr-3">
              <Eyebrow className="flex-1 truncate">{t('sectionSpatial')}</Eyebrow>
            </div>
            <SpatialRows node={metadata.spatialTree} depth={0} />
          </div>
        )}

        {Object.keys(classCounts).length > 0 && (
          <PropertySetGroup
            name={classTitle}
            properties={classCounts}
            open={openGroups[classTitle] ?? true}
            onToggle={() => { toggle(classTitle); }}
          />
        )}

        {bboxProps !== null && (
          <PropertySetGroup
            name={bboxTitle}
            properties={bboxProps}
            open={openGroups[bboxTitle] ?? true}
            onToggle={() => { toggle(bboxTitle); }}
          />
        )}

        <div className="border-t border-border" />
      </div>
    </div>
  );
}
