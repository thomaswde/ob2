import type { DecayClass } from "./types.js";

export const TOP_LEVEL_CATEGORIES = [
  "work",
  "family",
  "household",
  "vehicles",
  "health",
  "finance",
  "software-projects",
  "hobbies",
  "travel",
  "social",
] as const;

export const DEFAULT_CONFIDENCE = 0.8;
export const DEFAULT_QUERY_LIMIT = 10;
export const ENTITY_FUZZY_MATCH_THRESHOLD = 0.6;

export const DEFAULT_DECAY_CLASS: DecayClass = "profile";
