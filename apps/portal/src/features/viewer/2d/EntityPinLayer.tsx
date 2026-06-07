'use client';

import { FileBadge, Flag } from '@bimstitch/ui/icons';
import type { JSX } from 'react';

import type { PageDimensions } from '@bimstitch/viewer';

import type { EntityMarker2D, EntityMarkerType } from '../shared/entityMarkerTypes';

type EntityPinLayerProps = {
  markers: EntityMarker2D[];
  dims: PageDimensions;
  onMarkerClick: (type: EntityMarkerType, entityId: string) => void;
};

export function EntityPinLayer({
  markers,
  dims,
  onMarkerClick,
}: EntityPinLayerProps): JSX.Element {
  return (
    <div
      style={{
        width: dims.width,
        height: dims.height,
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    >
      {markers.map((marker) => (
        <button
          key={marker.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMarkerClick(marker.type, marker.entityId);
          }}
          style={{
            position: 'absolute',
            left: `${marker.x * 100}%`,
            top: `${marker.y * 100}%`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'auto',
          }}
          className="group cursor-pointer border-none bg-transparent p-0"
          title={marker.label}
        >
          {marker.type === 'finding' ? (
            <Flag className="h-5 w-5 fill-error stroke-white drop-shadow-md transition-transform group-hover:scale-125" />
          ) : (
            <FileBadge className="h-5 w-5 fill-info stroke-white drop-shadow-md transition-transform group-hover:scale-125" />
          )}
        </button>
      ))}
    </div>
  );
}
