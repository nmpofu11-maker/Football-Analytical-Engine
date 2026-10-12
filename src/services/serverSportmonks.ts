import dotenv from "dotenv";
dotenv.config();

export interface SportmonksFixture {
  id: string;
  date: string;
  time: string;
  kickoffUtc: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  competition: string;
  competitionId?: string;
  seasonId?: string;
  status: string;
  homeGoals?: number;
  awayGoals?: number;
  resultSettled: boolean;
  source: "sportmonks";
  sourceConfidence: "verified";
  ingestedAt: string;
}

export type SportmonksCallState =
  | "idle" | "not_configured" | "invalid_request" | "requesting"
  | "success" | "success_empty" | "partial" | "http_error" | "request_error";

interface Diagnostics {
  state: SportmonksCallState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastHttpStatus: number | null;
  lastFixtureCount: number;
  lastErrorCode: string | null;
  lastResponseTruncated: boolean;
}

let diagnostics: Diagnostics = {
  state: "idle",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastHttpStatus: null,
  lastFixtureCount: 0,
  lastErrorCode: null,
  lastResponseTruncated: false,
};

export function hasSportmonksKey(): boolean {
  const key = process.env.SPORTMONKS_API_KEY || process.env.SPORTMONKS_API_TOKEN || "";
  return Boolean(key.trim() && !["undefined", "null", "placeholder", "your_key_here"].includes(key.trim().toLowerCase()));
}

export function getSportmonksProviderDiagnostics() {
  return { configured: hasSportmonksKey(), ...diagnostics };
}

function parseKickoffUtc(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  // Sportmonks can return a timezone-naive timestamp. Requests explicitly ask
  // for UTC, so interpret that form as UTC rather than the machine's local zone.
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
    ? raw
    : raw.replace(" ", "T") + "Z";
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function participantList(raw: any): any[] {
  const value = raw?.participants?.data ?? raw?.participants;
  return Array.isArray(value) ? value : [];
}

function participantSide(participant: any): string {
  return String(
    participant?.meta?.location ??
    participant?.pivot?.location ??
    participant?.location ??
    participant?.side ??
    ""
  ).trim().toLowerCase();
}

function readParticipants(raw: any): { home: any; away: any } | null {
  const participants = participantList(raw);
  const home = participants.find(p => ["home", "1", "local"].includes(participantSide(p)));
  const away = participants.find(p => ["away", "2", "visitor"].includes(participantSide(p)));
  return home?.id && away?.id && home?.name && away?.name ? { home, away } : null;
}

function statusText(raw: any): string {
  const state = raw?.state?.data ?? raw?.state;
  return String(
    state?.short_name ?? state?.state ?? state?.name ??
    raw?.status?.short ?? raw?.status?.name ?? raw?.status ?? "UNKNOWN"
  ).trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function isFinishedStatus(status: string): boolean {
  return ["FT", "AET", "PEN", "FINISHED", "FINAL", "FULL_TIME", "FULLTIME", "AFTER_EXTRA_TIME", "AFTER_PENALTIES"].includes(status);
}

function readGoals(raw: any, homeId: string, awayId: string): { home?: number; away?: number } {
  const scoreRows = raw?.scores?.data ?? raw?.scores;
  if (!Array.isArray(scoreRows)) return {};
  const result: { home?: number; away?: number } = {};
  for (const row of scoreRows) {
    const goalsRaw = row?.score?.goals ?? row?.goals;
    const goals = typeof goalsRaw === "number" ? goalsRaw : Number(goalsRaw);
    if (!Number.isInteger(goals) || goals < 0) continue;
    const participantId = String(row?.participant_id ?? row?.participant?.id ?? "");
    const side = String(row?.score?.participant ?? row?.participant?.meta?.location ?? row?.meta?.location ?? "").toLowerCase();
    const description = String(row?.description ?? "").toUpperCase();
    // Prefer current/full-time score rows; other score types can be partial.
    if (description && !["CURRENT", "FT", "FULL_TIME", "FULLTIME"].includes(description)) continue;
    if (participantId === homeId || side === "home") result.home = goals;
    if (participantId === awayId || side === "away") result.away = goals;
  }
  return result;
}

/** Pure mapper: rejects incomplete records and never fabricates score values. */
export function normalizeSportmonksFixture(raw: any, ingestedAt = new Date().toISOString(), now = new Date()): SportmonksFixture | null {
  if (!raw || typeof raw !== "object" || raw.id === undefined || raw.id === null) return null;
  const participants = readParticipants(raw);
  const kickoff = parseKickoffUtc(raw.starting_at ?? raw.startingAt);
  const league = raw?.league?.data ?? raw?.league;
  const competition = typeof league?.name === "string" ? league.name.trim() : "";
  if (!participants || !kickoff || !competition) return null;

  const homeTeamId = String(participants.home.id);
  const awayTeamId = String(participants.away.id);
  const statusRaw = statusText(raw);
  const finished = isFinishedStatus(statusRaw) && kickoff.getTime() <= now.getTime() + 15 * 60 * 1000;
  const scores = readGoals(raw, homeTeamId, awayTeamId);
  const hasFinalScores = Number.isInteger(scores.home) && Number.isInteger(scores.away);
  const date = kickoff.toISOString();

  return {
    id: String(raw.id),
    date: date.slice(0, 10),
    time: date.slice(11, 16),
    kickoffUtc: date,
    homeTeam: String(participants.home.name).trim(),
    awayTeam: String(participants.away.name).trim(),
    homeTeamId,
    awayTeamId,
    competition,
    competitionId: String(raw.league_id ?? league?.id ?? "") || undefined,
    seasonId: String(raw.season_id ?? raw.season?.id ?? raw.season ?? "") || undefined,
    status: finished ? "FT" : isFinishedStatus(statusRaw) ? "NS" : statusRaw,
    homeGoals: finished && hasFinalScores ? scores.home : undefined,
    awayGoals: finished && hasFinalScores ? scores.away : undefined,
    resultSettled: finished && hasFinalScores,
    source: "sportmonks",
    sourceConfidence: "verified",
    ingestedAt,
  };
}

export async function fetchSportmonksFixtures(dateStr: string): Promise<SportmonksFixture[]> {
  if (!hasSportmonksKey()) {
    diagnostics = { ...diagnostics, state: "not_configured", lastFixtureCount: 0, lastErrorCode: "missing_api_key" };
    return [];
  }
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(dateStr)) ||
      new Date(`${dateStr}T00:00:00Z`).toISOString().slice(0, 10) !== dateStr) {
    diagnostics = { ...diagnostics, state: "invalid_request", lastAttemptAt: new Date().toISOString(), lastFixtureCount: 0, lastErrorCode: "invalid_date" };
    return [];
  }

  diagnostics = {
    ...diagnostics, state: "requesting", lastAttemptAt: new Date().toISOString(),
    lastHttpStatus: null, lastFixtureCount: 0, lastErrorCode: null, lastResponseTruncated: false,
  };

  const base = (process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com/v3/football").replace(/\\/+$/, "");
  const key = (process.env.SPORTMONKS_API_KEY || process.env.SPORTMONKS_API_TOKEN || "").trim();
  const allRecords: any[] = [];
  const maxPages = 5;
  let partialErrorCode: string | null = null;
  let truncated = false;

  try {
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(`${base}/fixtures/date/${encodeURIComponent(dateStr)}`);
      url.searchParams.set("include", "participants;scores;league;state;season");
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      const response = await fetch(url, {
        headers: { Authorization: key, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      diagnostics = { ...diagnostics, lastHttpStatus: response.status };
      if (!response.ok) {
        if (page === 1) {
          diagnostics = { ...diagnostics, state: "http_error", lastErrorCode: `http_${response.status}` };
          return [];
        }
        partialErrorCode = `http_${response.status}_page_${page}`;
        truncated = true;
        break;
      }

      const payload = await response.json() as any;
      if (!payload || !Array.isArray(payload.data)) {
        if (page === 1) {
          diagnostics = { ...diagnostics, state: "request_error", lastErrorCode: "invalid_response_shape" };
          return [];
        }
        partialErrorCode = `invalid_response_shape_page_${page}`;
        truncated = true;
        break;
      }
      allRecords.push(...payload.data);
      const hasMore = payload?.pagination?.has_more === true ||
        payload?.pagination?.hasMore === true ||
        payload?.meta?.pagination?.has_more === true;
      if (!hasMore) {
        truncated = false;
        break;
      }
      if (page === maxPages) truncated = true;
    }

    const ingestedAt = new Date().toISOString();
    const seen = new Set<string>();
    const fixtures = allRecords
      .map((item: any) => normalizeSportmonksFixture(item, ingestedAt))
      .filter((item: SportmonksFixture | null): item is SportmonksFixture => item !== null)
      .filter((item: SportmonksFixture) => {
        if (item.date !== dateStr || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    diagnostics = {
      ...diagnostics,
      state: partialErrorCode ? "partial" : fixtures.length ? "success" : "success_empty",
      lastSuccessAt: fixtures.length ? new Date().toISOString() : diagnostics.lastSuccessAt,
      lastFixtureCount: fixtures.length,
      lastErrorCode: partialErrorCode,
      lastResponseTruncated: truncated,
    };
    return fixtures;
  } catch {
    diagnostics = { ...diagnostics, state: "request_error", lastErrorCode: "request_failed" };
    return [];
  }
}
