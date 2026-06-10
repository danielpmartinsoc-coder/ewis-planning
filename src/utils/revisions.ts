/**
 * Revision sequence: A–Z, then AA–AZ, BA–BZ, … ZA–ZZ
 * Skips I and O (common aerospace practice — avoid confusion with 1 and 0).
 */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // 24 letters (no I, no O)

/** All valid single-character revisions */
const SINGLE = LETTERS.split('');

/** All valid two-character revisions (AA…ZZ, same letter exclusions) */
const DOUBLE: string[] = [];
for (const a of LETTERS) for (const b of LETTERS) DOUBLE.push(a + b);

export const ALL_REVISIONS: string[] = [...SINGLE, ...DOUBLE];

/**
 * Given the current latest revision used in a harness family,
 * return the next one in sequence. Returns null if already at ZZ.
 */
export function nextRevision(current: string): string | null {
  const upper = current.toUpperCase();
  const idx = ALL_REVISIONS.indexOf(upper);
  if (idx < 0 || idx >= ALL_REVISIONS.length - 1) return null;
  return ALL_REVISIONS[idx + 1];
}

/**
 * Given a list of revisions already used in a harness family,
 * return the next available revision after the highest used one.
 */
export function suggestNextRevision(usedRevisions: string[]): string {
  if (usedRevisions.length === 0) return 'A';
  const indices = usedRevisions
    .map(r => ALL_REVISIONS.indexOf(r.toUpperCase()))
    .filter(i => i >= 0);
  if (indices.length === 0) return 'A';
  const maxIdx = Math.max(...indices);
  return ALL_REVISIONS[Math.min(maxIdx + 1, ALL_REVISIONS.length - 1)];
}

/**
 * Generate the ID for a new revision of a harness.
 * Convention: REV A keeps the original ID, subsequent revisions get "-{REV}" suffix.
 * e.g. LW6 → LW6 (REV A), LW6-B (REV B), LW6-AA (REV AA)
 */
export function revisionId(baseId: string, revision: string): string {
  const upper = revision.toUpperCase();
  if (upper === 'A') return baseId;
  return `${baseId}-${upper}`;
}
