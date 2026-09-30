export const SUMMARY_SOFT_LIMIT = 72;

/** Joins summary and description the way git expects (blank line between). */
export function buildMessage(summary: string, body: string): string {
  const s = summary.trim();
  const b = body.trim();
  return b ? `${s}\n\n${b}` : s;
}
