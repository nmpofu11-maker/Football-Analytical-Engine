import dotenv from "dotenv";
dotenv.config();

export const SOCCER_SPORT_IDS = [
  { id: 11, name: "Premier League" },
  { id: 17, name: "La Liga" },
  { id: 16, name: "Serie A" },
  { id: 18, name: "Bundesliga" },
  { id: 19, name: "Ligue 1" },
  { id: 10, name: "MLS" },
  { id: 12, name: "Champions League" },
  { id: 13, name: "Europa League" }
];

const RATE_LIMIT_COOLDOWN_MS = 60_000;
let rateLimitedUntil = 0;

function validTeamName(value: any): string {
  const name = typeof value === "string" ? value.trim() : "";
  return name && !/^(home|away|team ?[ab]|tbd|unknown|n\/a|none)$/i.test(name) ? name : "";
}

export async function fetchTheRundownFixtures(dateStr: string): Promise<any[]> {
  const apiKey = process.env.THERUNDOWN_KEY || "";
  if (!apiKey) {
    console.warn("THERUNDOWN_KEY not configured.");
    return [];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(dateStr))) {
    console.warn("TheRundown fixture request rejected: invalid date.");
    return [];
  }

  if (Date.now() < rateLimitedUntil) {
    console.warn("TheRundown requests paused briefly after HTTP 429 rate limiting.");
    return [];
  }

  const allFixtures: any[] = [];
  const ingestedAt = new Date().toISOString();

  for (const sport of SOCCER_SPORT_IDS) {
    const url = `https://therundown.io/api/v2/sports/${sport.id}/events/${dateStr}?include=scores+all_periods`;
    try {
      const res = await fetch(url, {
        headers: {
          "X-TheRundown-Key": apiKey,
          "Accept": "application/json"
        }
      });
      if (res.status === 429) {
        rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        console.warn("TheRundown returned HTTP 429; pausing provider requests for 60 seconds.");
        break;
      }
      if (!res.ok) {
        console.warn(`TheRundown returned HTTP ${res.status} for ${sport.name}.`);
        continue;
      }
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
        const isFinished = finishedStatuses.has(statusType);
        const hasUsableScore = validScores && (isFinished || liveStatuses.has(statusType));

        allFixtures.push({
          id: String(eventId),
          date: dateStr,
          time: timeStr,
          homeTeam: homeName,
          awayTeam: awayName,
          competition: sport.name,
          status: isFinished ? "FT" : (liveStatuses.has(statusType) ? "LIVE" : scheduledStatuses.has(statusType) || !statusType ? "NS" : statusType),
          homeGoals: hasUsableScore ? homeScore : undefined,
          awayGoals: hasUsableScore ? awayScore : undefined,
          resultSettled: isFinished,
          source: "therundown",
          sourceConfidence: "verified",
          ingestedAt
        });
      }
    } catch (err: any) {
      console.warn(`TheRundown fetch warning for ${sport.name}:`, err?.message || err);
    }
  }

  return allFixtures;
}
