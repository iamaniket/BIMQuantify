import type { JSX } from 'react';

import { RemoteOrLocalImage } from './RemoteOrLocalImage';

type BlogPostCoverImageProps = {
  image: string;
  title: string;
};

export function BlogPostCoverImage({
  image,
  title,
}: BlogPostCoverImageProps): JSX.Element {
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl">
      <RemoteOrLocalImage
        src={image}
        alt={title}
        sizes="(max-width: 768px) 100vw, 1152px"
        priority
      />
    </div>
  );
}
