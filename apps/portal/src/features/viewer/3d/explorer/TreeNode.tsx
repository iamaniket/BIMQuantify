import type { EntityKey } from '@/stores/viewerEntityStore';

 
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
 
