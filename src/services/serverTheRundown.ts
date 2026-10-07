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

export async function fetchTheRundownFixtures(dateStr: string): Promise<any[]> {
  const apiKey = process.env.THERUNDOWN_KEY || "";
  if (!apiKey) {
    console.warn("THERUNDOWN_KEY not configured.");
    return [];
  }

  let allFixtures: any[] = [];

  for (const sport of SOCCER_SPORT_IDS) {
    const url = `https://therundown.io/api/v2/sports/${sport.id}/events/${dateStr}?include=scores+all_periods`;
    try {
      const res = await fetch(url, {
        headers: {
          "X-TheRundown-Key": apiKey,
          "Accept": "application/json"
        }
      });

      if (!res.ok) continue;
      const data = await res.json();
      const events = data.events || [];

      for (const ev of events) {
        const teams = ev.teams || [];
        const homeTeamObj = teams.find((t: any) => t.is_home) || teams[0] || { name: "Home" };
        const awayTeamObj = teams.find((t: any) => !t.is_home) || teams[1] || { name: "Away" };

        const homeName = homeTeamObj.name || "Home";
        const awayName = awayTeamObj.name || "Away";

        const scores = ev.score || {};
        const homeScore = scores.score_home;
        const awayScore = scores.score_away;
        const statusType = ev.score?.event_status || ev.status_type || "";

        const isFinished = statusType === "STATUS_FINAL" || (homeScore !== null && awayScore !== null && statusType !== "STATUS_IN_PROGRESS");

        const eventDate = ev.event_date ? new Date(ev.event_date) : new Date();
        const timeStr = eventDate.toISOString().substring(11, 16) || "15:00";

        allFixtures.push({
          id: ev.event_id || `rundown-${sport.id}-${Math.random().toString(36).substring(2, 9)}`,
          date: dateStr,
          time: timeStr,
          homeTeam: homeName,
          awayTeam: awayName,
          competition: sport.name,
          status: isFinished ? "FT" : (statusType === "STATUS_IN_PROGRESS" ? "LIVE" : "NS"),
          homeGoals: homeScore !== null && homeScore !== undefined ? Number(homeScore) : undefined,
          awayGoals: awayScore !== null && awayScore !== undefined ? Number(awayScore) : undefined,
          resultSettled: isFinished,
          source: "therundown",\n          sourceConfidence: "verified",\n        ingestedAt: new Date().toISOString()
        });
      }
    } catch (e: any) {
      console.warn(`TheRundown fetch warning for sport ${sport.name}:`, e.message);
    }
  }

  return allFixtures;
}
