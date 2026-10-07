export interface Fixture {
  id: string;
  date: string;
  time: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  wasDerby?: boolean;
  homeRank?: number;
  awayRank?: number;
  homeContinentalGap?: number;
  awayContinentalGap?: number;
  opponentLowBlock?: boolean;
  hasHighShotAccuracy?: boolean;
  possessionRatio?: number;
  source?: string;
  isBookmakerProtected?: boolean;
  status?: "NS" | "LIVE" | "FT" | "POSTPONED";
  finalScore?: { home: number; away: number };
  resultSettled?: boolean;
  settledAt?: string;
  resultSource?: string;
  odds?: { home: number; draw: number; away: number };
  probabilities?: { homeWinPct: number; drawPct: number; awayWinPct: number; marginPct: number };
  sourceConfidence?: "verified" | "unverified" | "unknown";\n  ingestedAt?: string;
}

export const FIXTURES_DATA: Fixture[] = [];
