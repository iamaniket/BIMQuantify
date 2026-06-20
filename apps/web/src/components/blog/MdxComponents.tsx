import type { MDXComponents } from 'mdx/types';
import type { AnchorHTMLAttributes, HTMLAttributes, JSX } from 'react';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function heading(Tag: 'h2' | 'h3' | 'h4') {
  return function MdxHeading(
    { children, ...rest }: HTMLAttributes<HTMLHeadingElement>,
  ): JSX.Element {
    const text = typeof children === 'string' ? children : '';
    const id = slugify(text);
    return (
      <Tag {...rest} id={id} className="scroll-mt-24">
        <a href={`#${id}`} className="no-underline hover:underline">
          {children}
        </a>
      </Tag>
    );
  };
}

export const mdxComponents: MDXComponents = {
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
  a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const { href } = props;
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    const isExternal = href != null
      && href.startsWith('http');
    return (
      <a
        {...props}
        className="text-primary underline decoration-primary underline-offset-2"
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
      />
    );
  },
  blockquote: (props: HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      {...props}
      className="border-l-4 border-primary-light bg-surface-low pl-4 italic text-foreground-secondary [&>p]:my-2"
    />
  ),
  table: (props: HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto">
      <table
        {...props}
        className="w-full border-collapse text-body2 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border [&_th]:bg-surface-low [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold"
      />
    </div>
  ),
  pre: (props: HTMLAttributes<HTMLPreElement>) => (
    <pre
      {...props}
      className="overflow-x-auto rounded-lg border border-border bg-surface-low p-4 text-body3"
    />
  ),
  code: (props: HTMLAttributes<HTMLElement>) => {
    const isInline = typeof props.children === 'string' && !props.className;
    if (isInline) {
      return (
        <code className="rounded bg-surface-low px-1.5 py-0.5 text-body3 text-foreground">
          {props.children}
        </code>
      );
    }
    return <code {...props} />;
  },
};
