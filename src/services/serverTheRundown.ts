import dotenv from "dotenv";
dotenv.config();

// IDs are TheRundown sport IDs, not league IDs from another provider.
// Keep this list aligned with the provider's published soccer catalog.
export const SOCCER_SPORT_IDS = [
  { id: 10, name: "MLS" },
  { id: 11, name: "Premier League" },
  { id: 12, name: "Ligue 1" },
  { id: 13, name: "Bundesliga" },
  { id: 14, name: "La Liga" },
  { id: 15, name: "Serie A" },
  { id: 16, name: "Champions League" },
  { id: 19, name: "J1 League" },
  { id: 34, name: "Liga MX" }
];

const BASE_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60_000;
const SUCCESS_CACHE_TTL_MS = 5 * 60_000;
let rateLimitedUntil = 0;
let consecutiveRateLimits = 0;
const fixtureCache = new Map<string, { expiresAt: number; fixtures: any[] }>();

type TheRundownCallState = "idle" | "not_configured" | "invalid_request" | "requesting" | "cached" | "success" | "success_empty" | "partial" | "rate_limited" | "http_error" | "request_error";

interface TheRundownCallDiagnostics {
  state: TheRundownCallState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastHttpStatus: number | null;
  lastFixtureCount: number;
  requestsAttempted: number;
  successfulResponses: number;
  lastErrorCode: string | null;
  cooldownUntil: string | null;
  lastServedFromCache: boolean;
}

let providerDiagnostics: TheRundownCallDiagnostics = {
  state: "idle",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastHttpStatus: null,
  lastFixtureCount: 0,
  requestsAttempted: 0,
  successfulResponses: 0,
  lastErrorCode: null,
  cooldownUntil: null,
  lastServedFromCache: false
};

export function getTheRundownProviderDiagnostics() {
  return {
    configured: Boolean(process.env.THERUNDOWN_KEY),
    ...providerDiagnostics
  };
}

function validTeamName(value: any): string {
  const name = typeof value === "string" ? value.trim() : "";
  return name && !/^(home|away|team ?[ab]|tbd|unknown|n\/a|none)$/i.test(name) ? name : "";
}

export async function fetchTheRundownFixtures(dateStr: string): Promise<any[]> {
  const apiKey = process.env.THERUNDOWN_KEY || "";
  if (!apiKey) {
    providerDiagnostics = { ...providerDiagnostics, state: "not_configured", lastFixtureCount: 0, lastErrorCode: "missing_api_key", lastServedFromCache: false };
    console.warn("THERUNDOWN_KEY not configured.");
    return [];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(dateStr))) {
    providerDiagnostics = { ...providerDiagnostics, state: "invalid_request", lastAttemptAt: new Date().toISOString(), lastFixtureCount: 0, lastErrorCode: "invalid_date", lastServedFromCache: false };
    console.warn("TheRundown fixture request rejected: invalid date.");
    return [];
  }

  const now = Date.now();
  const cached = fixtureCache.get(dateStr);
  if (cached && cached.expiresAt > now) {
    providerDiagnostics = { ...providerDiagnostics, state: "cached", lastFixtureCount: cached.fixtures.length, lastServedFromCache: true };
    return cached.fixtures.map(f => ({ ...f }));
  }
  if (cached) fixtureCache.delete(dateStr);

  if (now < rateLimitedUntil) {
    providerDiagnostics = {
      ...providerDiagnostics,
      state: "rate_limited",
      lastErrorCode: "http_429",
      cooldownUntil: new Date(rateLimitedUntil).toISOString(),
      lastServedFromCache: false
    };
    console.warn("TheRundown requests paused after HTTP 429 rate limiting.");
    return [];
  }

  providerDiagnostics = {
    ...providerDiagnostics,
    state: "requesting",
    lastAttemptAt: new Date().toISOString(),
    lastHttpStatus: null,
    lastFixtureCount: 0,
    requestsAttempted: 0,
    successfulResponses: 0,
    lastErrorCode: null,
    cooldownUntil: null,
    lastServedFromCache: false
  };

  const allFixtures: any[] = [];
  let successfulResponses = 0;
  let requestsAttempted = 0;
  let lastHttpStatus: number | null = null;
  let lastErrorCode: string | null = null;
  const ingestedAt = new Date().toISOString();

  for (const sport of SOCCER_SPORT_IDS) {
    const url = `https://therundown.io/api/v2/sports/${sport.id}/events/${dateStr}?include=scores+all_periods`;
    try {
      requestsAttempted += 1;
      const res = await fetch(url, {
        headers: {
          "X-TheRundown-Key": apiKey,
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(8_000)
      });
      lastHttpStatus = res.status;
      if (res.status === 429) {
        lastErrorCode = "http_429";
        consecutiveRateLimits += 1;
        const exponentialDelay = Math.min(
          MAX_RATE_LIMIT_COOLDOWN_MS,
          BASE_RATE_LIMIT_COOLDOWN_MS * (2 ** Math.min(consecutiveRateLimits - 1, 3))
        );
        const retryAfter = Number(res.headers.get("retry-after"));
        const providerDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
        rateLimitedUntil = Date.now() + Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, Math.max(exponentialDelay, providerDelay));
        console.warn("TheRundown returned HTTP 429; provider calls paused with bounded exponential backoff.");
        break;
      }
      if (!res.ok) {
        lastErrorCode = `http_${res.status}`;
        console.warn(`TheRundown returned HTTP ${res.status} for ${sport.name}.`);
        continue;
      }
      successfulResponses += 1;
      const payload: any = await res.json();
      const events = Array.isArray(payload?.events) ? payload.events : Array.isArray(payload?.data?.events) ? payload.data.events : [];
      for (const ev of events) {
        if (!ev || typeof ev !== "object") continue;
        const teams = Array.isArray(ev.teams) ? ev.teams : [];
        const homeObj = teams.find((t: any) => t?.is_home === true) ?? teams[0];
        const awayObj = teams.find((t: any) => t?.is_home === false) ?? teams[1];
        const homeName = validTeamName(homeObj?.name ?? homeObj?.team_name);
        const awayName = validTeamName(awayObj?.name ?? awayObj?.team_name);
        const eventId = ev.event_id ?? ev.id;
        if (!homeName || !awayName || homeName.toLowerCase() === awayName.toLowerCase() || eventId === undefined || eventId === null) continue;

        const rawDate = ev.event_date ?? ev.start_time ?? ev.datetime;
        const eventDate = rawDate ? new Date(rawDate) : null;
        if (!eventDate || Number.isNaN(eventDate.getTime()) || eventDate.toISOString().slice(0, 10) !== dateStr) continue;
        const timeStr = eventDate.toISOString().slice(11, 16);
        const scores = ev.score ?? {};
        const homeRaw = scores.score_home;
        const awayRaw = scores.score_away;
        const homeScore = homeRaw === null || homeRaw === undefined || homeRaw === "" ? undefined : Number(homeRaw);
        const awayScore = awayRaw === null || awayRaw === undefined || awayRaw === "" ? undefined : Number(awayRaw);
        const validScores = Number.isInteger(homeScore) && homeScore! >= 0 && Number.isInteger(awayScore) && awayScore! >= 0;
        const statusType = String(scores.event_status ?? ev.status_type ?? ev.status ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
        const finishedStatuses = new Set(["STATUS_FINAL", "FINAL", "FINISHED", "FT", "AET", "PEN", "FULLTIME", "MATCH_FINISHED"]);
        const liveStatuses = new Set(["STATUS_IN_PROGRESS", "STATUS_LIVE", "LIVE", "IN_PROGRESS", "INPLAY", "IN_PLAY", "1H", "2H", "1ST_HALF", "2ND_HALF", "HT", "HALF_TIME", "ET", "EXTRA_TIME", "PEN_LIVE", "PENALTIES"]);
        const scheduledStatuses = new Set(["NS", "SCHEDULED", "NOT_STARTED", "UPCOMING", "TBD", "TIMED", "FIXTURE", "STATUS_SCHEDULED", "STATUS_NOT_STARTED", "PRE_MATCH"]);
        // Scores alone are not proof that a match is finished: some feeds send 0-0 placeholders.
        // Reject impossible final/live states when the scheduled kickoff is still in the future.
        // This prevents stale provider 0-0 placeholders from being presented as verified results.
        const kickoffInFuture = eventDate.getTime() > Date.now() + 15 * 60 * 1000;
        const isFinished = finishedStatuses.has(statusType) && !kickoffInFuture;
        const isLive = liveStatuses.has(statusType) && !kickoffInFuture;
        const hasUsableScore = validScores && (isFinished || isLive);

        allFixtures.push({
          id: String(eventId),
          date: dateStr,
          time: timeStr,
          homeTeam: homeName,
          awayTeam: awayName,
          competition: sport.name,
          status: isFinished ? "FT" : (isLive ? "LIVE" : kickoffInFuture || scheduledStatuses.has(statusType) || !statusType ? "NS" : statusType),
          homeGoals: hasUsableScore ? homeScore : undefined,
          awayGoals: hasUsableScore ? awayScore : undefined,
          resultSettled: isFinished,
          source: "therundown",
          sourceConfidence: "verified",
          ingestedAt
        });
      }
    } catch (err: any) {
      lastHttpStatus = null;
      lastErrorCode = "request_failed";
      console.warn(`TheRundown fetch warning for ${sport.name}:`, err?.message || err);
      // A network/timeout failure is unlikely to improve by immediately making
      // eight more sequential requests; fail fast and let the next scheduled
      // refresh retry after the caller's cache/cooldown window.
      break;
    }
  }

  if (successfulResponses > 0) {
    // Cache successful and partial responses briefly to avoid every UI refresh
    // re-querying all eight competitions. A 429 cooldown remains authoritative.
    fixtureCache.set(dateStr, {
      expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS,
      fixtures: allFixtures.map(f => ({ ...f }))
    });
    while (fixtureCache.size > 12) {
      const oldestKey = fixtureCache.keys().next().value;
      if (oldestKey === undefined) break;
      fixtureCache.delete(oldestKey);
    }
    if (successfulResponses === SOCCER_SPORT_IDS.length) consecutiveRateLimits = 0;
  }

  const rateLimited = lastErrorCode === "http_429" && rateLimitedUntil > Date.now();
  const state: TheRundownCallState = rateLimited
    ? "rate_limited"
    : successfulResponses === SOCCER_SPORT_IDS.length
      ? (allFixtures.length ? "success" : "success_empty")
      : successfulResponses > 0
        ? "partial"
        : lastErrorCode?.startsWith("http_") ? "http_error" : "request_error";
  providerDiagnostics = {
    ...providerDiagnostics,
    state,
    lastSuccessAt: successfulResponses > 0 ? new Date().toISOString() : providerDiagnostics.lastSuccessAt,
    lastHttpStatus,
    lastFixtureCount: allFixtures.length,
    requestsAttempted,
    successfulResponses,
    lastErrorCode,
    cooldownUntil: rateLimitedUntil > Date.now() ? new Date(rateLimitedUntil).toISOString() : null,
    lastServedFromCache: false
  };

  return allFixtures;
}
