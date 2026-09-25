import { LearnedCoefficients, SimulationResult } from "../types";
import { isFastPacedLeagueTeam } from "../data/favoriteTeams";

/**
 * Calculates bias-free match predictions using the 10 Core Matrix Rules
 */
export function simulateMatchup(
  homeName: string,
  awayName: string,
  homeCoeffs: LearnedCoefficients,
  awayCoeffs: LearnedCoefficients,
  wasDerby: boolean,
  homeRank: number,
  awayRank: number,
  homeContinentalGap: number, // in days
  awayContinentalGap: number, // in days
  opponentLowBlock: boolean,
  hasHighShotAccuracy: boolean,
  possessionRatio: number, // Home possession percentage (e.g., 55)
  homeSampleSize: number,
  awaySampleSize: number
): SimulationResult {
  const reasons: string[] = [];

  // Base expected goals based on standard physical metrics
  let homeBaseXG = 1.40;
  let awayBaseXG = 1.20;
  reasons.push(`Base xG initialized: Home (${homeBaseXG.toFixed(2)}) vs Away (${awayBaseXG.toFixed(2)})`);

  // Rule 1: Form Momentum Weight
  homeBaseXG *= homeCoeffs.form_momentum_weight;
  awayBaseXG *= awayCoeffs.form_momentum_weight;
  reasons.push(`Rule 1 (Form Momentum applied): Adjusted xG to Home (${homeBaseXG.toFixed(2)}) & Away (${awayBaseXG.toFixed(2)}) using momentum weights.`);

  // Rule 2: Home Advantage Multiplier & Rule 5 (Derby adjustments)
  let homeAdv = homeCoeffs.home_advantage_multiplier;
  if (wasDerby) {
    // Local derby neutralizes standard home crowd advantage
    homeAdv = 1.04; 
    reasons.push(`Rule 5 (Local Derby detected): Neutralised standard home advantage from ${homeCoeffs.home_advantage_multiplier} to ${homeAdv.toFixed(2)}.`);
  } else {
    reasons.push(`Rule 2 (Home Advantage applied): Multiplied Home xG by home advantage coefficient (${homeAdv.toFixed(2)}).`);
  }
  homeBaseXG *= homeAdv;

  // Rule 3: Standing Ranks Gap
  const rankGap = awayRank - homeRank; // positive means Home is ranked better (lower number)
  const rankFactor = 1 + (rankGap * 0.012);
  // Cap rank factor between 0.75 and 1.35 to prevent unrealistic values
  const homeRankMultiplier = Math.max(0.75, Math.min(1.35, rankFactor));
  const awayRankMultiplier = Math.max(0.75, Math.min(1.35, 1 / rankFactor));
  homeBaseXG *= homeRankMultiplier;
  awayBaseXG *= awayRankMultiplier;
  reasons.push(`Rule 3 (Standing Rank Gap of ${rankGap} slots): Scaled Home by ${homeRankMultiplier.toFixed(2)}x and Away by ${awayRankMultiplier.toFixed(2)}x.`);

  // Rule 4: Contextual Fatigue / Rotation Penalties (< 4 days gap)
  if (homeContinentalGap <= 3) {
    homeBaseXG *= homeCoeffs.fatigue_penalty_modifier;
    reasons.push(`Rule 4 (Contextual Fatigue Home): Played continental fixture ${homeContinentalGap} days ago. Deducted points using fatigue penalty (${homeCoeffs.fatigue_penalty_modifier.toFixed(2)}x).`);
  }
  if (awayContinentalGap <= 3) {
    awayBaseXG *= awayCoeffs.fatigue_penalty_modifier;
    reasons.push(`Rule 4 (Contextual Fatigue Away): Played continental fixture ${awayContinentalGap} days ago. Deducted points using fatigue penalty (${awayCoeffs.fatigue_penalty_modifier.toFixed(2)}x).`);
  }

  // Rule 6: Geographic Volatility Dampeners (Japan, Norway, Sweden, China, South Korea)
  const isHomeFastPaced = isFastPacedLeagueTeam(homeName);
  const isAwayFastPaced = isFastPacedLeagueTeam(awayName);
  let volatilityDampener = 1.0;

  if (isHomeFastPaced || isAwayFastPaced) {
    // Apply dampener from the fast-paced league team
    const teamDampener = isHomeFastPaced ? homeCoeffs.volatility_index : awayCoeffs.volatility_index;
    volatilityDampener = teamDampener;
    reasons.push(`Rule 6 (Geographic Volatility Dampener): Applied fast-paced league offset (${volatilityDampener.toFixed(2)}) for high-tempo transitions.`);
  }

  // Rule 7: Low-Block defense & Shot Accuracy Gaps
  if (opponentLowBlock) {
    if (hasHighShotAccuracy) {
      homeBaseXG *= 1.15;
      reasons.push(`Rule 7 (Compact Low-Block Countered): Positive shot accuracy gap unlocked defensive lines. Boosted Home xG by 1.15x.`);
    } else {
      homeBaseXG *= 0.85;
      reasons.push(`Rule 7 (Compact Low-Block Defended): Opponent low-block restricted space. Reduced Home xG by 0.85x.`);
    }
  }

  // Rule 8: Possession Dominance Graphs
  const possessionDiff = possessionRatio - 50; // positive means home dominates
  const possessionFactor = 1 + (possessionDiff * 0.01);
  homeBaseXG *= possessionFactor;
  awayBaseXG *= (2 - possessionFactor);
  reasons.push(`Rule 8 (Possession Dominance Graph): ${possessionRatio}% - ${(100 - possessionRatio)}% split adjusted expected goals.`);

  // Final xG limits
  homeBaseXG = Math.max(0.1, homeBaseXG);
  awayBaseXG = Math.max(0.1, awayBaseXG);

  // Compute final expected score (poisson style probability matrix)
  // Let's perform a lightweight simulation to establish Win/Draw/Loss percentages
  const probabilities = simulatePoissonOutcome(homeBaseXG, awayBaseXG, volatilityDampener);

  // Percentage-based confidence interval based on sample sizes
  const avgSampleSize = (homeSampleSize + awaySampleSize) / 2;
  // Asymptotic model confidence towards 95%
  const confidencePercentage = Math.round(50 + 45 * (1 - Math.exp(-avgSampleSize / 8.0)));
  
  // Statistical margin of error based on sample size confidence bounds
  const confidenceMargin = Math.max(0.15, 1.96 * (1.1 / Math.sqrt(avgSampleSize + 1)));
  const homeConfidenceLower = Number(Math.max(0, homeBaseXG - confidenceMargin).toFixed(2));
  const homeConfidenceUpper = Number((homeBaseXG + confidenceMargin).toFixed(2));
  const awayConfidenceLower = Number(Math.max(0, awayBaseXG - confidenceMargin).toFixed(2));
  const awayConfidenceUpper = Number((awayBaseXG + confidenceMargin).toFixed(2));

  reasons.push(`Rule 9 (Confidence Calibration): Ingestion sample sizes (Home: ${homeSampleSize}, Away: ${awaySampleSize}) resolved a ${confidencePercentage}% prediction confidence interval.`);

  return {
    homeExpectedGoals: Number(homeBaseXG.toFixed(2)),
    awayExpectedGoals: Number(awayBaseXG.toFixed(2)),
    homeScore: Math.round(homeBaseXG),
    awayScore: Math.round(awayBaseXG),
    homeWinProbability: Math.round(probabilities.homeWin * 100),
    drawProbability: Math.round(probabilities.draw * 100),
    awayWinProbability: Math.round(probabilities.awayWin * 100),
    reasons,
    confidencePercentage,
    homeConfidenceLower,
    homeConfidenceUpper,
    awayConfidenceLower,
    awayConfidenceUpper
  };
}

// Helper to simulate poisson distribution probabilities for scoreboards
function simulatePoissonOutcome(lambdaHome: number, lambdaAway: number, volatility: number) {
  // Let's generate probability spreads for scorelines 0 to 5 for home and away
  const maxGoals = 5;
  const homeProb: number[] = [];
  const awayProb: number[] = [];

  for (let i = 0; i <= maxGoals; i++) {
    homeProb[i] = (Math.pow(lambdaHome, i) * Math.exp(-lambdaHome)) / factorial(i);
    awayProb[i] = (Math.pow(lambdaAway, i) * Math.exp(-lambdaAway)) / factorial(i);
  }

  // Normalize remaining tails
  const sumHome = homeProb.reduce((a, b) => a + b, 0);
  const sumAway = awayProb.reduce((a, b) => a + b, 0);
  for (let i = 0; i <= maxGoals; i++) {
    homeProb[i] /= sumHome;
    awayProb[i] /= sumAway;
  }

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const jointProb = homeProb[h] * awayProb[a];
      if (h > a) {
        homeWin += jointProb;
      } else if (h === a) {
        draw += jointProb;
      } else {
        awayWin += jointProb;
      }
    }
  }

  // If geographic volatility dampener is less than 1.0, it pushes probabilities towards a more conservative model (e.g. higher draw probability)
  if (volatility < 1.0) {
    const shift = (1.0 - volatility) * 0.25;
    draw += (homeWin * shift + awayWin * shift);
    homeWin *= (1 - shift);
    awayWin *= (1 - shift);
  }

  const total = homeWin + draw + awayWin;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total
  };
}

function factorial(n: number): number {
  if (n === 0 || n === 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}
