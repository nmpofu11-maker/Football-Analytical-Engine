import fs from "fs";
import path from "path";
import { LOCKED_80_TEAMS, isFastPacedLeagueTeam } from "./src/data/favoriteTeams";

const DATA_DIR = path.join(process.cwd(), "data");

// Helper to generate default team coefficients matrices
function generateDefaultMatricesServer(): Record<string, any> {
  const matrices: Record<string, any> = {};
  LOCKED_80_TEAMS.forEach(team => {
    const isFast = isFastPacedLeagueTeam(team);
    matrices[team] = {
      sample_size_matches: 0,
      learned_coefficients: {
        home_advantage_multiplier: 1.12,
        form_momentum_weight: 0.95,
        volatility_index: isFast ? 0.82 : 1.00,
        fatigue_penalty_modifier: 0.92
      }
    };
  });
  return matrices;
}

export interface FixtureDbEntry {
  id: string;
  date: string;
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
  status: "NS" | "LIVE" | "FT" | "POSTPONED";
  finalScore?: {
    home: number;
    away: number;
  };
  resultSettled?: boolean;
  settledAt?: string;
  resultSource?: string;
  source: string;
}

export interface PredictionDbEntry {
  id: string;
  fixture_id: string;
  predicted_outcome: "1" | "X" | "2"; // 1 = Home, X = Draw, 2 = Away
  predicted_home_score: number;
  predicted_away_score: number;
  confidence: number;
  coefficients_snapshot: {
    home: any;
    away: any;
  };
  model_version: string;
  created_at: string;
  source: string;
}

export interface CoefficientHistoryEntry {
  id: string;
  team: string;
  timestamp: string;
  home_advantage_multiplier: number;
  form_momentum_weight: number;
  volatility_index: number;
  fatigue_penalty_modifier: number;
  sample_size_matches: number;
  trigger_reason: string;\n  evidence_source?: string;
}

// Ensure database files exist
export function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const files = {
    "db_matrices.json": () => generateDefaultMatricesServer(),
    "db_fixtures.json": () => [],
    "db_predictions.json": () => [],
    "db_coefficient_history.json": () => []
  };

  for (const [filename, getInitial] of Object.entries(files)) {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) {
      saveFileAtomic(filePath, getInitial());
    }
  }
}

function saveFileAtomic(filePath: string, data: any) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempPath, filePath);
}

// Database Getters & Setters
export function getMatrices(): Record<string, any> {
  initDb();
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "db_matrices.json"), "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return generateDefaultMatricesServer();
  }
}

export function saveMatrices(matrices: Record<string, any>) {
  initDb();
  saveFileAtomic(path.join(DATA_DIR, "db_matrices.json"), matrices);
}

export function getFixtures(): FixtureDbEntry[] {
  initDb();
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "db_fixtures.json"), "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function saveFixtures(fixtures: FixtureDbEntry[]) {
  initDb();
  saveFileAtomic(path.join(DATA_DIR, "db_fixtures.json"), fixtures);
}

export function getPredictions(): PredictionDbEntry[] {
  initDb();
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "db_predictions.json"), "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function savePredictions(predictions: PredictionDbEntry[]) {
  initDb();
  saveFileAtomic(path.join(DATA_DIR, "db_predictions.json"), predictions);
}

export function getCoefficientHistory(): CoefficientHistoryEntry[] {
  initDb();
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "db_coefficient_history.json"), "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function saveCoefficientHistory(history: CoefficientHistoryEntry[]) {
  initDb();
  saveFileAtomic(path.join(DATA_DIR, "db_coefficient_history.json"), history);
}

// Add prediction with Snapshot
export function addPrediction(pred: Omit<PredictionDbEntry, "id" | "created_at">): PredictionDbEntry {
  const preds = getPredictions();
  const newPred: PredictionDbEntry = {
    ...pred,
    id: `pred-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    created_at: new Date().toISOString()
  };
  preds.push(newPred);
  savePredictions(preds);
  return newPred;
}

// Add history entry
export function addHistoryEntry(entry: Omit<CoefficientHistoryEntry, "id" | "timestamp">) {
  const history = getCoefficientHistory();
  const newEntry: CoefficientHistoryEntry = {
    ...entry,
    id: `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString()
  };
  history.push(newEntry);
  saveCoefficientHistory(history);
}

// Apply Learning Calibration Algorithm
export function applyCalibrationServer(homeTeam: string, awayTeam: string, homeGoals: number, awayGoals: number, homeXg: number, awayXg: number, wasDerby: boolean, matchId: string, evidenceSource: string = "verified-result") {
  const matrices = getMatrices();
  let updatedCount = 0;

  const report = {
    homeTeam,
    awayTeam,
    homeGoals,
    awayGoals,
    homeXG: homeXg,
    awayXG: awayXg,
    wasDerby
  };

  [report.homeTeam, report.awayTeam].forEach((teamName) => {
    if (matrices[teamName]) {
      updatedCount++;
      const current = matrices[teamName];
      const matchesCount = current.sample_size_matches + 1;
      
      const alpha = 0.15; // Calibration moving learning rate factor
      let homeAdvFactor = current.learned_coefficients.home_advantage_multiplier;
      let formWeightFactor = current.learned_coefficients.form_momentum_weight;
      let fatigueFactor = current.learned_coefficients.fatigue_penalty_modifier;

      // Rule-based form momentum calibration: if performance exceeds expectation, improve. Otherwise decay.
      const isHome = teamName === report.homeTeam;
      const score = isHome ? report.homeGoals : report.awayGoals;
      const xG = isHome ? report.homeXG : report.awayXG;

      if (score > xG) {
        formWeightFactor = Math.min(1.20, formWeightFactor * (1 + alpha * 0.05));
      } else if (score < xG && score === 0) {
        formWeightFactor = Math.max(0.80, formWeightFactor * (1 - alpha * 0.05));
      }

      // Home advantage calibration
      if (isHome && score > report.awayGoals && !report.wasDerby) {
        homeAdvFactor = Math.min(1.25, homeAdvFactor * (1 + alpha * 0.03));
      }

      matrices[teamName] = {
        sample_size_matches: matchesCount,
        learned_coefficients: {
          ...current.learned_coefficients,
          home_advantage_multiplier: Number(homeAdvFactor.toFixed(3)),
          form_momentum_weight: Number(formWeightFactor.toFixed(3)),
          fatigue_penalty_modifier: Number(fatigueFactor.toFixed(3))
        }
      };

      // Log coefficient change event history
      addHistoryEntry({
        team: teamName,
        home_advantage_multiplier: Number(homeAdvFactor.toFixed(3)),
        form_momentum_weight: Number(formWeightFactor.toFixed(3)),
        volatility_index: Number(current.learned_coefficients.volatility_index.toFixed(3)),
        fatigue_penalty_modifier: Number(fatigueFactor.toFixed(3)),
        sample_size_matches: matchesCount,
        trigger_reason: `Calibrated from verified out-of-sample result [${report.homeTeam} vs ${report.awayTeam} (${report.homeGoals}-${report.awayGoals})]. ID: ${matchId}`,\n        evidence_source: evidenceSource
      });
    }
  });

  if (updatedCount > 0) {
    saveMatrices(matrices);
    console.log(`[LEARNING SYSTEM] Calibrated coefficients for ${updatedCount} target team(s) from match ${homeTeam} vs ${awayTeam}`);
  }
}
