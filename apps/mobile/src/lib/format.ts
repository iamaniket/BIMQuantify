/** "permit_review" -> "Permit Review". Used for display-only enum strings. */
export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
