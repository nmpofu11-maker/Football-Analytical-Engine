import { Fixture } from "../data/fixtures";

/**
 * Normalizes team names for robust composite deduplication.
 * Removes common club abbreviations, punctuation, and extraneous spacing.
 */
export function normalizeTeamName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/\b(fc|cf|sc|afc|ac|as|ssc|cd|fk|sk|bk|if|ff|w|women|ladies|u21|u23|reserves|united|city|rovers|athletic|town)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Generates the hardened composite deduplication key:
 * ${normalize(homeTeam)}_vs_${normalize(awayTeam)}_${kickoffDate}
 */
export function getFixtureCompositeKey(homeTeam: string, awayTeam: string, kickoffDate: string): string {
  const normHome = normalizeTeamName(homeTeam) || homeTeam.toLowerCase().replace(/\s+/g, "");
  const normAway = normalizeTeamName(awayTeam) || awayTeam.toLowerCase().replace(/\s+/g, "");
  return `${normHome}_vs_${normAway}_${kickoffDate}`;
}

/**
 * Hardened ingestion & merge engine:
 * Protects bookmaker-imported and manually ingested slates (e.g., Hollywoodbets, lower leagues)
 * from being overwritten or wiped by external automated scoreboards (e.g. ESPN feeds).
 */
export function mergeFixtureSlates(
  existingList: Fixture[],
  incomingList: Fixture[],
  options: {
    incomingIsBookmaker?: boolean;
    rollingCutoffDate?: string;
  } = {}
): Fixture[] {
  const { incomingIsBookmaker = false, rollingCutoffDate } = options;

  // Build map of existing fixtures indexed by composite key
  const compositeMap = new Map<string, Fixture>();

  for (const item of existingList) {
    // If rollingCutoffDate is provided, retain only items from rolling 48-hour cutoff onwards
    if (rollingCutoffDate && item.date < rollingCutoffDate) {
      continue;
    }
    const key = getFixtureCompositeKey(item.homeTeam, item.awayTeam, item.date);
    compositeMap.set(key, item);
  }

  for (const item of incomingList) {
    if (rollingCutoffDate && item.date < rollingCutoffDate) {
      continue;
    }
    const key = getFixtureCompositeKey(item.homeTeam, item.awayTeam, item.date);
    const existing = compositeMap.get(key);

    if (!existing) {
      // New match - add directly
      compositeMap.set(key, {
        ...item,
        isBookmakerProtected: incomingIsBookmaker || item.source === "bookmaker-import" || item.isBookmakerProtected
      });
      continue;
    }

    // Protection rule:
    // If existing match was imported from a bookmaker slate or marked protected,
    // NEVER overwrite it with an automated scoreboard or generic API scraper!
    if (existing.isBookmakerProtected || existing.source === "bookmaker-import" || existing.source === "manual-ingest") {
      if (incomingIsBookmaker) {
        // If incoming is an explicit bookmaker update, merge updated odds while keeping integrity
        compositeMap.set(key, {
          ...existing,
          ...item,
          isBookmakerProtected: true,
          source: "bookmaker-import"
        });
      } else {
        // External automated scoreboard: Preserve existing bookmaker slate, optionally enrich secondary fields
        compositeMap.set(key, {
          ...existing,
          competition: existing.competition || item.competition,
          wasDerby: existing.wasDerby || item.wasDerby
        });
      }
    } else {
      // Normal merge where incoming updates existing
      compositeMap.set(key, {
        ...existing,
        ...item,
        isBookmakerProtected: incomingIsBookmaker || item.source === "bookmaker-import" || item.isBookmakerProtected
      });
    }
  }

  // Sort by date ascending, then time ascending
  return Array.from(compositeMap.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });
}
