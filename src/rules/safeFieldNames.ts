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
]);

function normalize(fieldName: string): string {
  return fieldName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSafeFieldName(fieldName: string): boolean {
  return SAFE_FIELD_NAMES.has(normalize(fieldName));
}
