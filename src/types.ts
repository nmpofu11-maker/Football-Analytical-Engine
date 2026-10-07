export interface LearnedCoefficients {
  home_advantage_multiplier: number;
  form_momentum_weight: number;
  volatility_index: number;
  fatigue_penalty_modifier: number;
}

export interface TeamIntelligenceMatrix {
  sample_size_matches: number;
  learned_coefficients: LearnedCoefficients;
  last_calibrated_at?: string;
}

export interface SyncPayload {
  sync_timestamp: string;
  model_engine: string;
  meta_improvement_notes: string;
  team_intelligence_matrices: Record<string, TeamIntelligenceMatrix>;
}

export interface MatchReport {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals?: number;
  awayGoals?: number;
  homeXG?: number;
  awayXG?: number;
  homePossession?: number;
  awayPossession?: number;
  pitchFacts?: string[];
  wasDerby?: boolean;
  competition?: string;
  isFastPacedLeague?: boolean;
}

export interface SimulationResult {
  homeScore: number;
  awayScore: number;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  reasons: string[];
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  confidencePercentage: number | null;
  homeConfidenceLower: number | null;
  homeConfidenceUpper: number | null;
  awayConfidenceLower: number | null;
  awayConfidenceUpper: number | null;
  confidenceStatus: "available" | "insufficient-data";
}
