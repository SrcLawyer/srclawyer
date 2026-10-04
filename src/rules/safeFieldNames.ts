// Exact-match only, deliberately narrow -- this is the one silent-drop path in the whole pipeline
// (a name on this list never becomes a finding at all, not even a low-confidence one flagged for
// review). Names that are ALSO plausible PII in some real API (e.g. "next"/"prev" as redirect
// targets, "since"/"until"/"before"/"after" as ambiguous short words) are deliberately left off even
// when they're common pagination/cursor names elsewhere, so they stay visible for manual review
// rather than being silently and permanently suppressed.
const SAFE_FIELD_NAMES = new Set([
  "id",
  "uuid",
  "guid",
  "createdat",
  "updatedat",
  "deletedat",
  "timestamp",
  "status",
  "state",
  "version",
  "page",
  "limit",
  "offset",
  "count",
  "total",
  "sort",
  "order",
  "perpage",
  "pagesize",
  "cursor",
  "nextcursor",
  "prevcursor",
  "sortby",
  "orderby",
  "sortorder",
]);

function normalize(fieldName: string): string {
  return fieldName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSafeFieldName(fieldName: string): boolean {
  return SAFE_FIELD_NAMES.has(normalize(fieldName));
}
