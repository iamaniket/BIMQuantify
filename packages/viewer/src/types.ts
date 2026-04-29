/**
 * Public types — kept in their own file so a future xeokit-backed
 * implementation only has to honour these exact shapes.
 */

export type ViewerBundle = {
  fragmentsUrl: string;
  metadataUrl?: string;
  propertiesUrl?: string;
};

export type IfcViewerProps = {
  bundle: ViewerBundle;
  className?: string;
  onReady?: () => void;
  onError?: (err: Error) => void;
};
