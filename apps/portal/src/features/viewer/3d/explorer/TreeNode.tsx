import type { EntityKey } from '@/stores/viewerEntityStore';

/* eslint-disable no-restricted-syntax -- ?:  needed for exactOptionalPropertyTypes */
export type TreeNodeData = {
  key: string;
  label: string;
  type?: string;
  entityKeys: EntityKey[];
  children?: TreeNodeData[];
  count?: number;
  color?: string;
  mono?: boolean;
};
/* eslint-enable no-restricted-syntax */
