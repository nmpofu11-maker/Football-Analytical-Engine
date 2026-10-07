import { Fixture } from "../data/fixtures";

/**
 * Stable fixture identity. We only remove punctuation/diacritics and harmless
 * competition suffixes; words such as "City", "United" and "Athletic" remain
 * because removing them can collapse distinct clubs.
 */
export function normalizeTeamName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|afc|ac|ssc|cd|fk|sk|bk|if|ff)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function getFixtureCompositeKey(homeTeam: string, awayTeam: string, kickoffDate: string): string {
  const normHome = normalizeTeamName(homeTeam) || homeTeam.toLowerCase().replace(/\s+/g, "");
  const normAway = normalizeTeamName(awayTeam) || awayTeam.toLowerCase().replace(/\s+/g, "");
  return `${normHome}_vs_${normAway}_${kickoffDate}`;
}

export function mergeFixtureSlates(
  existingList: Fixture[],
  incomingList: Fixture[],
  options: { incomingIsBookmaker?: boolean; rollingCutoffDate?: string } = {}
): Fixture[] {
  const { incomingIsBookmaker = false, rollingCutoffDate } = options;
  const map = new Map<string, Fixture>();

  const priority = (source?: string) => {
    if (source === "sportapi-ai") return 100;
    if (source === "therundown" || source === "custom-results-api") return 90;
    if (source === "bookmaker-import" || source === "hollywoodbets-pdf" || source === "manual-ingest") return 80;
    if (source === "espn") return 30;
    return 10;
  };

  const add = (item: Fixture, isIncoming: boolean) => {
    if (!item?.homeTeam || !item?.awayTeam || !item?.date) return;
    if (rollingCutoffDate && item.date < rollingCutoffDate) return;
    const key = getFixtureCompositeKey(item.homeTeam, item.awayTeam, item.date);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...item, ingestedAt: item.ingestedAt || new Date().toISOString() });
      return;
    }

    const bookmakerProtected = prev.isBookmakerProtected || prev.source === "bookmaker-import" || prev.source === "hollywoodbets-pdf";
    if (bookmakerProtected && !incomingIsBookmaker && item.source !== "custom-results-api") {
      map.set(key, {
        ...prev,
        competition: prev.competition || item.competition,
        status: item.status && item.status !== "NS" ? item.status : prev.status,
        finalScore: item.finalScore || prev.finalScore,
        resultSettled: item.resultSettled ?? prev.resultSettled,
        settledAt: item.settledAt || prev.settledAt,
        resultSource: item.resultSource || prev.resultSource
      });
      return;
    }

    const useIncoming = isIncoming && (priority(item.source) > priority(prev.source) ||
      (priority(item.source) === priority(prev.source) &&
       (!prev.ingestedAt || !item.ingestedAt || item.ingestedAt >= prev.ingestedAt)));

    map.set(key, {
      ...(useIncoming ? prev : item),
      ...(useIncoming ? item : prev),
      source: useIncoming ? item.source : prev.source,
      sourceConfidence: useIncoming ? (item.sourceConfidence || prev.sourceConfidence) : prev.sourceConfidence,
      ingestedAt: useIncoming ? (item.ingestedAt || prev.ingestedAt) : prev.ingestedAt,
      isBookmakerProtected: incomingIsBookmaker || item.source === "bookmaker-import" || item.source === "hollywoodbets-pdf" || prev.isBookmakerProtected || false
    });
  };

  existingList.forEach(x => add(x, false));
  incomingList.forEach(x => add(x, true));

  return Array.from(map.values()).sort((a,b) =>
    a.date === b.date ? (a.time || "99:99").localeCompare(b.time || "99:99") : a.date.localeCompare(b.date)
  );
}
