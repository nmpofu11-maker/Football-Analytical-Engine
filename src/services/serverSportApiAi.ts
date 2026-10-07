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
}

export async function fetchSportApiAiFixtures(dateStr: string): Promise<SportApiAiFixture[]> {
  const apiKey = process.env.SPORTAPI_AI_KEY || "";
  if (!apiKey) {
    console.warn("SPORTAPI_AI_KEY not configured.");
    return [];
  }

  const url = `https://sportapi.ai/api/fixtures/date/${dateStr}`;
  try {
    const res = await fetch(url, {
      headers: {
        "X-Api-Key": apiKey,
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
        "User-Agent": "Football-Analytical-Engine/1.0"
      }
    });

    const rawText = await res.text();
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    const firstBracket = rawText.indexOf('[');
    const lastBracket = rawText.lastIndexOf(']');

    let parsed: any = [];
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket && (firstBrace === -1 || firstBracket < firstBrace)) {
      const jsonStr = rawText.substring(firstBracket, lastBracket + 1);
      parsed = JSON.parse(jsonStr);
    } else if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonStr = rawText.substring(firstBrace, lastBrace + 1);
      const data = JSON.parse(jsonStr);
      parsed = Array.isArray(data) ? data : (data.fixtures || data.data || data.matches || []);
    } else {
      parsed = JSON.parse(rawText);
    }

    const items = Array.isArray(parsed) ? parsed : (parsed.fixtures || parsed.data || parsed.matches || []);

    return items.map((f: any) => {
      const home = typeof f.home_team === "object" ? (f.home_team?.name || f.homeTeam || "Home") : (f.home_team || f.homeTeam || "Home");
      const away = typeof f.away_team === "object" ? (f.away_team?.name || f.awayTeam || "Away") : (f.away_team || f.awayTeam || "Away");
      const comp = typeof f.competition === "object" ? (f.competition?.name || f.competition || "League") : (f.competition || "League");
      
      const rawDt = f.datetime || f.kickoff_time || f.date || `${dateStr}T15:00:00Z`;
      let timeStr = "15:00";
      if (rawDt.includes("T")) {
        timeStr = rawDt.split("T")[1]?.substring(0, 5) || "15:00";
      } else if (rawDt.includes(" ")) {
        timeStr = rawDt.split(" ")[1]?.substring(0, 5) || "15:00";
      }

      const rawStatus = (f.status || f.match_status || "NS").toUpperCase();
      const hScore = Number(f.home_score ?? f.homeGoals ?? f.home_goals ?? -1);
      const aScore = Number(f.away_score ?? f.awayGoals ?? f.away_goals ?? -1);

      const isFinished = ["FINISHED", "FT", "AET", "PEN", "FINAL", "FULLTIME"].includes(rawStatus) || (hScore >= 0 && aScore >= 0 && rawStatus !== "LIVE");

      return {
        id: f.id || `sportapi-${Math.random().toString(36).substring(2, 9)}`,
        date: dateStr,
        time: timeStr,
        homeTeam: home,
        awayTeam: away,
        competition: comp,
        status: isFinished ? "FT" : rawStatus,
        homeGoals: hScore >= 0 ? hScore : undefined,
        awayGoals: aScore >= 0 ? aScore : undefined,
        resultSettled: isFinished,
        source: "sportapi-ai",
        sourceConfidence: "verified",\n        ingestedAt: new Date().toISOString()
      };
    });
  } catch (err: any) {
    console.error("SportAPI.ai fetch error:", err.message);
    return [];
  }
}
