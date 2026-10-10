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
        const statusType = String(scores.event_status ?? ev.status_type ?? ev.status ?? "").toUpperCase();
        const isFinished = ["STATUS_FINAL", "FINAL", "FINISHED", "FT", "AET", "PEN"].includes(statusType) ||
          (validScores && !["STATUS_IN_PROGRESS", "LIVE", "IN_PROGRESS", "NS", "SCHEDULED"].includes(statusType));

        allFixtures.push({
          id: String(eventId),
          date: dateStr,
          time: timeStr,
          homeTeam: homeName,
          awayTeam: awayName,
          competition: sport.name,
          status: isFinished ? "FT" : (["STATUS_IN_PROGRESS", "LIVE", "IN_PROGRESS"].includes(statusType) ? "LIVE" : "NS"),
          homeGoals: validScores ? homeScore : undefined,
          awayGoals: validScores ? awayScore : undefined,
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
