'use client';

/**
 * Client-reference re-exports of `@bimdossier/ui/icons` for use inside React
 * Server Components. Phosphor's icon components read `IconContext` via
 * `useContext` and ship without a `"use client"` directive, so importing them
 * straight into an async server component (e.g. `FromTheBlogSection`) crashes
 * at render time. Re-exporting from this client module turns each icon into a
 * client reference the RSC can safely render. Client components keep importing
 * from `@bimdossier/ui/icons` directly.
 */
export { ArrowRight } from '@bimdossier/ui/icons';
