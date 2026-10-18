import { DATA_CATEGORY_LABELS } from "../policy/dataCategoryLabels.js";
import type { DataCategory } from "../engine/types.js";

/** Kinds of data for which no suggested wording is generated (docs/question-catalog.md section 3.1). */
export const SENSITIVE_CATEGORIES: ReadonlySet<string> = new Set<DataCategory>([
  "childrens_data",
  "health_data",
  "government_id",
  "microphone_audio",
  "camera_video",
  "location",
]);

/** The display label for a category id; an unknown id (a baseline from another version) is shown as is. */
export function categoryLabel(category: string): string {
  return (DATA_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

/** The label lower-cased for use inside a sentence, keeping an acronym such as "IP" intact. */
export function lowerLabel(category: string): string {
  const label = categoryLabel(category);
  return /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}
