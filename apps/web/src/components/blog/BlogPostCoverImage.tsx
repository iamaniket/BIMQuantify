import Image from 'next/image';
import type { JSX } from 'react';

type BlogPostCoverImageProps = {
  image: string;
  title: string;
};

export function BlogPostCoverImage({
  image,
  title,
}: BlogPostCoverImageProps): JSX.Element {
  const isRemote = /^https?:\/\//i.test(image);
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl">
      {isRemote ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <Image
          src={image}
          alt={title}
          fill
          priority
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 1152px"
        />
      )}
    </div>
  );
}
