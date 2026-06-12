/**
 * Semantic colour tone for a calendar chip — maps to the design-system status
 * tokens (`info` / `primary` / `success` / `warning` / `error`, plus `neutral`).
 *
 * Colour carries exactly one meaning across the calendar: item *status*. The
 * three item *kinds* are told apart by an icon, never by colour (research note
 * §4 — never rely on colour alone).
 */
export type CalendarTone =
  | 'neutral'
  | 'info'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error';
