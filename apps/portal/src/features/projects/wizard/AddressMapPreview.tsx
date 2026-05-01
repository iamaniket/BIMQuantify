'use client';

import { MapPin } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import { isWithinNetherlands, pdokAerialThumbnailUrl } from '@/lib/mapThumbnail';

export type AddressMapPreviewProps = {
  latitude: number | undefined;
  longitude: number | undefined;
};

const containerBase = 'relative flex w-full items-center justify-center overflow-hidden '
  + 'rounded-md border border-border bg-background-secondary aspect-[2/1] max-h-48';

const placeholderInnerClass = 'flex flex-col items-center gap-1 px-4 text-center '
  + 'text-body3 text-foreground-tertiary';

function roundCoord(value: number): number {
  // ~1 m precision; prevents URL churn when address picker re-emits identical
  // suggestions or when subscribers re-fire on unrelated form changes.
  return Math.round(value * 100000) / 100000;
}

export function AddressMapPreview({
  latitude,
  longitude,
}: AddressMapPreviewProps): JSX.Element {
  const [hasError, setHasError] = useState(false);

  const url = useMemo(() => {
    if (latitude === undefined || longitude === undefined) return null;
    if (!isWithinNetherlands(latitude, longitude)) return null;
    return pdokAerialThumbnailUrl(roundCoord(latitude), roundCoord(longitude));
  }, [latitude, longitude]);

  const wrapperClass = containerBase;

  if (latitude === undefined || longitude === undefined) {
    return (
      <div className={wrapperClass} aria-hidden="true">
        <div className={placeholderInnerClass}>
          <MapPin className="h-5 w-5" />
          <span>Pick an address to see an aerial preview.</span>
        </div>
      </div>
    );
  }

  if (!isWithinNetherlands(latitude, longitude)) {
    return (
      <div
        className={wrapperClass}
        role="img"
        aria-label="Map preview unavailable outside the Netherlands"
      >
        <div className={placeholderInnerClass}>
          <MapPin className="h-5 w-5" />
          <span>Aerial preview unavailable outside the Netherlands.</span>
        </div>
      </div>
    );
  }

  if (hasError || url === null) {
    return (
      <div className={wrapperClass} role="img" aria-label="Map preview failed to load">
        <div className={placeholderInnerClass}>
          <MapPin className="h-5 w-5" />
          <span>Map preview is currently unavailable.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`Aerial view at ${String(latitude)}, ${String(longitude)}`}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        onError={() => { setHasError(true); }}
        onLoad={() => { setHasError(false); }}
      />
    </div>
  );
}
