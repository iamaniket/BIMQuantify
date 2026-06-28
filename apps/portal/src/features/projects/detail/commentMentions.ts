/**
 * @mention helpers shared by the comment composer and the thread renderer.
 *
 * Canonical wire format (what the API parses + stores): `@[Display Name](uuid)`.
 * The composer shows clean `@Display Name` display text and tracks the picked
 * mentions; {@link buildCommentText} serializes display text back to canonical
 * tokens on submit. Reconstruction is fail-safe: a mention whose `@Name` text
 * was edited away simply isn't emitted (no token, no notification) — we never
 * produce a token for someone the user didn't pick.
 */

export type MemberLike = {
  user_id: string;
  full_name: string | null;
  email: string;
};

export type PickedMention = { label: string; userId: string };

export type CommentSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; userId: string; label: string };

const MENTION_TOKEN = /@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)/g;

export function memberDisplayName(member: MemberLike): string {
  return member.full_name ?? member.email;
}

export function serializeMention(label: string, userId: string): string {
  return `@[${label}](${userId})`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a canonical comment body into text + mention segments (thread render). */
export function parseCommentSegments(text: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const start = match.index;
    const label = match[1];
    const userId = match[2];
    if (label !== undefined && userId !== undefined) {
      if (start > lastIndex) {
        segments.push({ type: 'text', value: text.slice(lastIndex, start) });
      }
      segments.push({ type: 'mention', userId, label });
      lastIndex = start + match[0].length;
    }
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

/** Canonical tokens -> clean display text (`@[Name](uuid)` -> `@Name`), for
 * seeding the composer when editing an existing comment. */
export function tokensToDisplay(text: string): string {
  return text.replace(MENTION_TOKEN, (_full, label: string) => `@${label}`);
}

/** Extract the picked mentions from a canonical comment body (edit seeding). */
export function parseMentionsFromText(text: string): PickedMention[] {
  const out: PickedMention[] = [];
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const label = match[1];
    const userId = match[2];
    if (label !== undefined && userId !== undefined) {
      out.push({ label, userId });
    }
  }
  return out;
}

/** Display text (`@Name`) -> canonical tokens (`@[Name](uuid)`). Longest labels
 * first so `@Jan de Vries` is matched before `@Jan`. */
export function buildCommentText(displayText: string, mentions: PickedMention[]): string {
  let result = displayText;
  const sorted = [...mentions].sort((a, b) => b.label.length - a.label.length);
  for (const mention of sorted) {
    const pattern = new RegExp(`@${escapeRegExp(mention.label)}`, 'g');
    result = result.replace(pattern, serializeMention(mention.label, mention.userId));
  }
  return result;
}
