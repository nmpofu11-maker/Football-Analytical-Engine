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
  source?: "bookmaker-import" | "hollywoodbets-pdf" | "manual-ingest" | "espn" | "verified-manifest" | "gemini-search-grounded" | "quota-fallback" | "custom-results-api";
  isBookmakerProtected?: boolean;
  status?: "NS" | "LIVE" | "FT" | "POSTPONED";
  finalScore?: {
    home: number;
    away: number;
  };
  resultSettled?: boolean;
  settledAt?: string;
  resultSource?: string;
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
