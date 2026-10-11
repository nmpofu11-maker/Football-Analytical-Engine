import dotenv from "dotenv";
dotenv.config();

export interface SportApiAiFixture {
  id: string | number;
  date: string;
  time: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  status: string;
  homeGoals?: number;
  awayGoals?: number;
  resultSettled: boolean;
  source: string;
  sourceConfidence: "verified";
  ingestedAt: string;
}

export type ProviderCallState = "idle" | "not_configured" | "invalid_request" | "requesting" | "success" | "success_empty" | "http_error" | "request_error";

interface ProviderCallDiagnostics {
  state: ProviderCallState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastHttpStatus: number | null;
  lastFixtureCount: number;
  lastErrorCode: string | null;
}

let providerDiagnostics: ProviderCallDiagnostics = {
  state: "idle",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastHttpStatus: null,
  lastFixtureCount: 0,
  lastErrorCode: null
};

export function getSportApiAiProviderDiagnostics() {
  return {
    configured: Boolean(process.env.SPORTAPI_AI_KEY),
    ...providerDiagnostics
  };
}

function readTeam(value: any): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const name = value.name ?? value.team_name ?? value.display_name;
    return typeof name === "string" ? name.trim() : "";
  }
  return "";
}

function readItems(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["fixtures", "data", "matches", "results", "events"]) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === "object") {
      for (const nested of ["fixtures", "data", "matches", "results", "events"]) {
        if (Array.isArray(payload[key][nested])) return payload[key][nested];
      }
    }
  }
  return [];
}

function isPlaceholderTeam(name: string): boolean {
  return !name || /^(home|away|team ?[ab]|tbd|unknown|n\/a|none)$/i.test(name);
}

function isPlaceholderCompetition(name: string): boolean {
  return !name.trim() || /^(unknown|unknown competition|competition unavailable|unavailable|not available|n\/a|na|none|tbd|league fixture)$/i.test(name.trim());
}

export async function fetchSportApiAiFixtures(dateStr: string): Promise<SportApiAiFixture[]> {
  const apiKey = process.env.SPORTAPI_AI_KEY || "";
  if (!apiKey) {
    providerDiagnostics = { ...providerDiagnostics, state: "not_configured", lastFixtureCount: 0, lastErrorCode: "missing_api_key" };
    console.warn("SPORTAPI_AI_KEY not configured.");
    return [];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(dateStr))) {
    providerDiagnostics = { ...providerDiagnostics, state: "invalid_request", lastAttemptAt: new Date().toISOString(), lastFixtureCount: 0, lastErrorCode: "invalid_date" };
    console.warn("SportAPI.ai fixture request rejected: invalid date.");
    return [];
  }

  providerDiagnostics = {
    ...providerDiagnostics,
    state: "requesting",
    lastAttemptAt: new Date().toISOString(),
    lastHttpStatus: null,
    lastFixtureCount: 0,
    lastErrorCode: null
  };

  try {
    const res = await fetch(`https://sportapi.ai/api/fixtures?date=${encodeURIComponent(dateStr)}`, {
      headers: {
        "X-Api-Key": apiKey,
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
        "User-Agent": "Football-Analytical-Engine/1.0"
      },
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      providerDiagnostics = { ...providerDiagnostics, state: "http_error", lastHttpStatus: res.status, lastErrorCode: `http_${res.status}` };
      console.warn(`SportAPI.ai returned HTTP ${res.status}.`);
      return [];
    }

    providerDiagnostics = { ...providerDiagnostics, lastHttpStatus: res.status };
    const payload = await res.json();
    const items = readItems(payload);
    const ingestedAt = new Date().toISOString();
    const fixtures: SportApiAiFixture[] = [];

    for (const f of items) {
      if (!f || typeof f !== "object") continue;
      const home = readTeam(f.home_team ?? f.homeTeam ?? f.home ?? f.teams?.home);
      const away = readTeam(f.away_team ?? f.awayTeam ?? f.away ?? f.teams?.away);
      if (isPlaceholderTeam(home) || isPlaceholderTeam(away) || home.toLowerCase() === away.toLowerCase()) continue;

      const rawDate = f.datetime ?? f.kickoff_time ?? f.kickoff ?? f.start_time ?? f.date;
      const parsedDate = typeof rawDate === "string" || typeof rawDate === "number" ? new Date(rawDate) : null;
      const validKickoff = parsedDate && !Number.isNaN(parsedDate.getTime());
      // A provider record without an explicit, parseable kickoff cannot be verified for a requested date.
      if (!validKickoff) continue;
      const fixtureDate = parsedDate!.toISOString().slice(0, 10);
      const time = parsedDate!.toISOString().slice(11, 16);
      if (fixtureDate !== dateStr) continue;

      const id = f.id ?? f.fixture_id ?? f.event_id;
      if (id === undefined || id === null || String(id).trim() === "") continue;

      const rawStatus = String(f.status ?? f.match_status ?? f.fixture_status ?? "NS").trim().toUpperCase().replace(/[\s-]+/g, "_");
      const homeRaw = f.home_score ?? f.homeGoals ?? f.home_goals ?? f.scores?.home ?? f.score?.home;
      const awayRaw = f.away_score ?? f.awayGoals ?? f.away_goals ?? f.scores?.away ?? f.score?.away;
      const homeScore = homeRaw === null || homeRaw === undefined || homeRaw === "" ? undefined : Number(homeRaw);
      const awayScore = awayRaw === null || awayRaw === undefined || awayRaw === "" ? undefined : Number(awayRaw);
      const validScores = Number.isInteger(homeScore) && homeScore! >= 0 && Number.isInteger(awayScore) && awayScore! >= 0;
      const liveStatuses = new Set(["LIVE", "STATUS_LIVE", "INPLAY", "IN_PLAY", "IN_PROGRESS", "STATUS_IN_PROGRESS", "1H", "2H", "1ST_HALF", "2ND_HALF", "HT", "HALF_TIME", "ET", "EXTRA_TIME", "PEN_LIVE", "PENALTIES"]); 
      const scheduledStatuses = new Set(["NS", "SCHEDULED", "NOT_STARTED", "UPCOMING", "TBD", "TIMED", "FIXTURE", "STATUS_SCHEDULED", "STATUS_NOT_STARTED", "PRE_MATCH"]);
      const finishedStatuses = new Set(["FINISHED", "FT", "AET", "PEN", "FINAL", "FULLTIME", "FULL_TIME", "STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_FINISHED", "MATCH_FINISHED"]);
      // Only explicit final statuses settle results. Some feeds send 0-0 placeholders for upcoming fixtures.
      // A provider cannot legitimately report a match as finished before its kickoff.
      // Guard against stale or malformed FT/0-0 placeholders for future fixtures.
      const kickoffInFuture = parsedDate!.getTime() > Date.now() + 15 * 60 * 1000;
      const isFinished = finishedStatuses.has(rawStatus) && !kickoffInFuture;
      const isLive = liveStatuses.has(rawStatus) && !kickoffInFuture;
      const hasUsableScore = validScores && (isFinished || isLive);
      const competitionCandidates = [f.competition, f.league, f.tournament, f.competition_name, f.league_name, f.tournament_name, f.competition?.name, f.league?.name, f.tournament?.name, f.competition?.competition_name, f.league?.league_name, f.tournament?.tournament_name, f.competition?.title, f.league?.title, f.tournament?.title];
      const competition = competitionCandidates.find((value) => typeof value === "string" && value.trim())?.trim() || competitionCandidates.find((value) => value && typeof value === "object")?.name?.trim?.() || "";
      // A fixture without real competition metadata is incomplete; don't label it
      // verified or leak generic provider placeholders into the trusted fixture slate.
      if (isPlaceholderCompetition(competition)) continue;

      fixtures.push({
        id: String(id),
        date: fixtureDate,
        time,
        homeTeam: home,
        awayTeam: away,
        competition,
        status: isFinished ? "FT" : isLive ? "LIVE" : (kickoffInFuture || scheduledStatuses.has(rawStatus)) ? "NS" : rawStatus,
        homeGoals: hasUsableScore ? homeScore : undefined,
        awayGoals: hasUsableScore ? awayScore : undefined,
        resultSettled: isFinished && validScores,
        source: "sportapi-ai",
        sourceConfidence: "verified",
        ingestedAt
      });
    }

    providerDiagnostics = {
      ...providerDiagnostics,
      state: fixtures.length ? "success" : "success_empty",
      lastSuccessAt: new Date().toISOString(),
      lastFixtureCount: fixtures.length,
      lastErrorCode: null
    };
    return fixtures;
  } catch (err: any) {
    providerDiagnostics = { ...providerDiagnostics, state: "request_error", lastErrorCode: "request_failed" };
    console.error("SportAPI.ai fetch error:", err?.message || err);
    return [];
  }
}
