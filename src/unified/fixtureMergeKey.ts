import { normalizeTeamName } from "./teamIdentity";

export interface FixtureMergeIdentity {
  homeTeam: string;
  awayTeam: string;
  date: string;
  competition?: string;
  time?: string;
  kickoffUtc?: string;
}

/**
 * Key used only for merging fixture observations. When competition and kickoff
 * are known they are mandatory identity dimensions, preventing same-team
 * fixtures on the same day from being silently merged together.
 */
export function buildFixtureMergeKey(input: FixtureMergeIdentity): string | null {
  const home = normalizeTeamName(input.homeTeam);
  const away = normalizeTeamName(input.awayTeam);
  const date = String(input.date || "").trim();
  if (!home || !away || !date || home === away) return null;

  const competition = normalizeTeamName(input.competition || "");
  let kickoffMinute = "";
  if (input.kickoffUtc) {
    const parsed = new Date(input.kickoffUtc);
    if (Number.isFinite(parsed.getTime())) kickoffMinute = parsed.toISOString().slice(11, 16);
  }
  if (!kickoffMinute && /^\d{2}:\d{2}$/.test(String(input.time || ""))) {
    kickoffMinute = String(input.time);
  }

  const base = [home, away, date].join("_vs_");
  if (!competition || !kickoffMinute) return base;
  return [base, competition, kickoffMinute].join("_");
}
