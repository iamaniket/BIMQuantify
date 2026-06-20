import Image from 'next/image';
import type { JSX } from 'react';

type RemoteOrLocalImageProps = {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
};

/**
 * Cover image that picks the right element by URL kind. Absolute http(s) URLs
 * (presigned MinIO/S3 covers from API-published posts) use a plain `<img>`
 * because next/image rejects domains not declared in `remotePatterns`; local
 * `/public` paths go through next/image (`<Image fill>`). The caller provides
 * the positioned wrapper (it owns aspect ratio / rounding).
 */
export function RemoteOrLocalImage({
  src,
  alt,
  sizes,
  priority = false,
}: RemoteOrLocalImageProps): JSX.Element {
  const isRemote = /^https?:\/\//i.test(src);
  if (isRemote) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />;
  }
  return <Image src={src} alt={alt} fill priority={priority} className="object-cover" sizes={sizes} />;
}
