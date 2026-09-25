export interface Fixture {
  id: string;
  date: string; // YYYY-MM-DD
  time: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  wasDerby: boolean;
  homeRank: number;
  awayRank: number;
  homeContinentalGap: number;
  awayContinentalGap: number;
  opponentLowBlock: boolean;
  hasHighShotAccuracy: boolean;
  possessionRatio: number;
  source?: "bookmaker-import" | "manual-ingest" | "espn" | "verified-manifest" | "gemini-search-grounded" | "quota-fallback";
  isBookmakerProtected?: boolean;
  odds?: {
    home: number;
    draw: number;
    away: number;
  };
  probabilities?: {
    homeWinPct: number;
    drawPct: number;
    awayWinPct: number;
    marginPct: number;
  };
}

// Clean baseline - real fixtures are retrieved dynamically and persisted to server disk
export const FIXTURES_DATA: Fixture[] = [];
