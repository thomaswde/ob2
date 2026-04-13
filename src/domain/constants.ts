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
export const DEFAULT_RECENT_BRIDGE_LIMIT = 50;
export const PROJECTION_INDEX_LIMIT = 200;
export const LIFE_STATE_MAX_BYTES = 2048;
export const QUERY_TARGET_TOKENS = 500;
export const QUERY_HARD_CAP_TOKENS = 1000;

export const DEFAULT_DECAY_CLASS: DecayClass = "profile";
