import { LearnedCoefficients, SimulationResult } from "../types";
import { isFastPacedLeagueTeam } from "../data/favoriteTeams";

/**
 * Deterministic, evidence-gated football model.
 * Missing inputs are never replaced with invented ranks, possession, tactical states or sample sizes.
 * Bookmaker odds are intentionally not accepted by this function.
 */
export function simulateMatchup(
  homeName: string,
  awayName: string,
  homeCoeffs: LearnedCoefficients,
  awayCoeffs: LearnedCoefficients,
  wasDerby: boolean | undefined,
  homeRank: number | undefined,
  awayRank: number | undefined,
  homeContinentalGap: number | undefined,
  awayContinentalGap: number | undefined,
  opponentLowBlock: boolean | undefined,
  hasHighShotAccuracy: boolean | undefined,
  possessionRatio: number | undefined,
  homeSampleSize: number,
  awaySampleSize: number
): SimulationResult {
  const reasons: string[] = [];
  let homeXG = 1.40;
  let awayXG = 1.20;

  reasons.push("Baseline model prior applied; no bookmaker odds are used.");
  if (homeSampleSize <= 0 || awaySampleSize <= 0) {
    reasons.push("Historical calibration is insufficient for at least one team; confidence is unavailable.");
  }

  homeXG *= homeCoeffs.form_momentum_weight;
  awayXG *= awayCoeffs.form_momentum_weight;

  if (wasDerby === true) {
    homeXG *= 1.04;
    reasons.push("Derby adjustment applied from verified fixture context.");
  } else if (wasDerby === false) {
    homeXG *= homeCoeffs.home_advantage_multiplier;
    reasons.push("Home-advantage coefficient applied.");
  } else {
    reasons.push("Derby status unknown; no derby adjustment applied.");
  }

  if (typeof homeRank === "number" && typeof awayRank === "number" && homeRank > 0 && awayRank > 0) {
    const rankGap = awayRank - homeRank;
    const rankFactor = Math.max(0.75, Math.min(1.35, 1 + rankGap * 0.012));
    homeXG *= rankFactor;
    awayXG *= 1 / rankFactor;
    reasons.push("Standing-rank adjustment applied from supplied rank evidence.");
  } else {
    reasons.push("Standing ranks unavailable; rank rule skipped.");
  }

  if (typeof homeContinentalGap === "number" && homeContinentalGap >= 0 && homeContinentalGap <= 3) {
    homeXG *= homeCoeffs.fatigue_penalty_modifier;
    reasons.push("Home fatigue adjustment applied from supplied recovery interval.");
  }
  if (typeof awayContinentalGap === "number" && awayContinentalGap >= 0 && awayContinentalGap <= 3) {
    awayXG *= awayCoeffs.fatigue_penalty_modifier;
    reasons.push("Away fatigue adjustment applied from supplied recovery interval.");
  }

  const fastHome = isFastPacedLeagueTeam(homeName);
  const fastAway = isFastPacedLeagueTeam(awayName);
  const volatility = fastHome ? homeCoeffs.volatility_index : fastAway ? awayCoeffs.volatility_index : 1;
  if (fastHome || fastAway) {
    reasons.push("Geographic volatility coefficient applied from team classification.");
  }

  if (opponentLowBlock === true && typeof hasHighShotAccuracy === "boolean") {
    if (hasHighShotAccuracy) {
      homeXG *= 1.15;
      reasons.push("Low-block/shot-accuracy interaction applied.");
    } else {
      homeXG *= 0.85;
      reasons.push("Low-block constraint applied.");
    }
  } else if (opponentLowBlock === true) {
    reasons.push("Low-block reported but shot-accuracy evidence is missing; interaction skipped.");
  }

  if (typeof possessionRatio === "number" && possessionRatio >= 0 && possessionRatio <= 100) {
    const possessionFactor = 1 + ((possessionRatio - 50) * 0.01);
    homeXG *= possessionFactor;
    awayXG *= 2 - possessionFactor;
    reasons.push("Possession adjustment applied from supplied possession evidence.");
  } else {
    reasons.push("Possession evidence unavailable; possession rule skipped.");
  }

  homeXG = Math.max(0.1, homeXG);
  awayXG = Math.max(0.1, awayXG);
  const probabilities = simulatePoissonOutcome(homeXG, awayXG, volatility);

  return {
    homeExpectedGoals: Number(homeXG.toFixed(2)),
    awayExpectedGoals: Number(awayXG.toFixed(2)),
    homeScore: Math.round(homeXG),
    awayScore: Math.round(awayXG),
    homeWinProbability: Math.round(probabilities.homeWin * 100),
    drawProbability: Math.round(probabilities.draw * 100),
    awayWinProbability: Math.round(probabilities.awayWin * 100),
    reasons,
    confidencePercentage: null,
    homeConfidenceLower: null,
    homeConfidenceUpper: null,
    awayConfidenceLower: null,
    awayConfidenceUpper: null,
    confidenceStatus: "insufficient-data"
  };
}

function simulatePoissonOutcome(lambdaHome: number, lambdaAway: number, volatility: number) {
  const maxGoals = 7;
  const homeProb: number[] = [];
  const awayProb: number[] = [];

  for (let i = 0; i <= maxGoals; i++) {
    homeProb[i] = (Math.pow(lambdaHome, i) * Math.exp(-lambdaHome)) / factorial(i);
    awayProb[i] = (Math.pow(lambdaAway, i) * Math.exp(-lambdaAway)) / factorial(i);
  }

  const sumHome = homeProb.reduce((a, b) => a + b, 0);
  const sumAway = awayProb.reduce((a, b) => a + b, 0);
  for (let i = 0; i <= maxGoals; i++) {
    homeProb[i] /= sumHome;
    awayProb[i] /= sumAway;
  }

  let homeWin = 0, draw = 0, awayWin = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const jointProb = homeProb[h] * awayProb[a];
      if (h > a) homeWin += jointProb;
      else if (h === a) draw += jointProb;
      else awayWin += jointProb;
    }
  }

  if (volatility < 1) {
    const shift = Math.min(0.25, Math.max(0, 1 - volatility) * 0.25);
    draw += (homeWin + awayWin) * shift;
    homeWin *= 1 - shift;
    awayWin *= 1 - shift;
  }

  const total = homeWin + draw + awayWin;
  return { homeWin: homeWin / total, draw: draw / total, awayWin: awayWin / total };
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}
