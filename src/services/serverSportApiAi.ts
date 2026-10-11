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

export async function fetchSportApiAiFixtures(dateStr: string): Promise<SportApiAiFixture[]> {
  const apiKey = process.env.SPORTAPI_AI_KEY || "";
  if (!apiKey) {
    console.warn("SPORTAPI_AI_KEY not configured.");
    return [];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(dateStr))) {
    console.warn("SportAPI.ai fixture request rejected: invalid date.");
    return [];
  }

  try {
    const res = await fetch(`https://sportapi.ai/api/fixtures/date/${dateStr}`, {
      headers: {
        "X-Api-Key": apiKey,
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
        "User-Agent": "Football-Analytical-Engine/1.0"
      }
    });
    if (!res.ok) {
      console.warn(`SportAPI.ai returned HTTP ${res.status}.`);
      return [];
    }

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
      const scheduledStatuses = new Set(["NS", "SCHEDULED", "NOT_STARTED", "UPCOMING", "TBD", "TIMED", "FIXTURE"]);
      const liveStatuses = new Set(["LIVE", "INPLAY", "IN_PROGRESS", "1H", "2H", "HT", "ET", "PEN_LIVE"]);
      const finishedStatuses = new Set(["FINISHED", "FT", "AET", "PEN", "FINAL", "FULLTIME", "STATUS_FINAL", "MATCH_FINISHED"]);
      // Only explicit final statuses settle results. Some feeds send 0-0 placeholders for upcoming fixtures.
      const isFinished = finishedStatuses.has(rawStatus);
      const hasUsableScore = validScores && !scheduledStatuses.has(rawStatus);
      const competitionCandidates = [f.competition, f.league, f.tournament, f.competition_name, f.league_name, f.tournament_name, f.competition?.name, f.league?.name, f.tournament?.name, f.competition?.competition_name, f.league?.league_name, f.tournament?.tournament_name, f.competition?.title, f.league?.title, f.tournament?.title];
      const competition = competitionCandidates.find((value) => typeof value === "string" && value.trim())?.trim() || competitionCandidates.find((value) => value && typeof value === "object")?.name?.trim?.() || "";

      fixtures.push({
        id: String(id),
        date: fixtureDate,
        time,
        homeTeam: home,
        awayTeam: away,
        competition: competition || "Competition unavailable",
        status: isFinished ? "FT" : liveStatuses.has(rawStatus) ? "LIVE" : rawStatus,
        homeGoals: hasUsableScore ? homeScore : undefined,
        awayGoals: hasUsableScore ? awayScore : undefined,
        resultSettled: isFinished,
        source: "sportapi-ai",
        sourceConfidence: "verified",
        ingestedAt
      });
    }

    return fixtures;
  } catch (err: any) {
    console.error("SportAPI.ai fetch error:", err?.message || err);
    return [];
  }
}
