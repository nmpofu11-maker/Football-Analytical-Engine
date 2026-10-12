/**
 * Canonical contracts and integrity gates for the unified football platform.
 *
 * This module deliberately contains no provider/network calls and no prediction
 * defaults. Unknown evidence stays unknown until a provider observation is
 * validated and attached to a canonical fixture.
 */

export type EvidenceStatus = "verified" | "stale" | "conflict" | "invalid" | "missing";
export type FixtureStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "unknown";

export interface Provenance {
  provider: string;
  providerEventId?: string;
  retrievedAt: string;
  sourceUrl?: string;
  payloadHash?: string;
}

export interface CanonicalFixture {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  seasonId: string;
  kickoffUtc: string;
  status: FixtureStatus;
  providerEventIds: Record<string, string>;
}

export interface ProviderObservation<T> {
  fixtureId: string;
  provider: string;
  retrievedAt: string;
  status: EvidenceStatus;
  value?: T;
  reason?: string;
  provenance: Provenance;
}

export interface MatchResult {
  fixtureId: string;
  homeGoals: number;
  awayGoals: number;
  status: "verified-final";
  verifiedAt: string;
  provenance: Provenance[];
}

export interface OddsSnapshot {
  fixtureId: string;
  market: string;
  selectionOdds: Record<string, number | null>;
  capturedAt: string;
  bookmaker: string;
  provenance: Provenance;
}

export interface ProbabilityDistribution {
  home: number;
  draw: number;
  away: number;
}

export interface PredictionSnapshot {
  id: string;
  fixtureId: string;
  createdAt: string;
  dataCutoffUtc: string;
  modelVersion: string;
  probabilities: ProbabilityDistribution | null;
  evidenceStatus: "eligible" | "exploratory" | "withheld";
  reasons: string[];
}

export interface ModelVersion {
  id: string;
  createdAt: string;
  trainingCutoffUtc: string;
  evaluationWindowStartUtc: string;
  evaluationWindowEndUtc: string;
  metrics: {
    logLoss?: number;
    brierScore?: number;
    sampleSize: number;
  };
  approved: boolean;
}

const isIsoDate = (value: string): boolean =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));

/** Validate canonical identity without silently repairing malformed input. */
export function validateCanonicalFixture(fixture: CanonicalFixture): string[] {
  const errors: string[] = [];
  if (!fixture.id.trim()) errors.push("fixture id is required");
  if (!fixture.homeTeamId.trim()) errors.push("home team id is required");
  if (!fixture.awayTeamId.trim()) errors.push("away team id is required");
  if (fixture.homeTeamId === fixture.awayTeamId) errors.push("home and away team ids must differ");
  if (!fixture.competitionId.trim()) errors.push("competition id is required");
  if (!fixture.seasonId.trim()) errors.push("season id is required");
  if (!isIsoDate(fixture.kickoffUtc)) errors.push("kickoff must be an ISO timestamp with timezone");
  if (!fixture.status) errors.push("fixture status is required");
  return errors;
}

/**
 * A fallback identity for reconciliation only. It requires competition, season,
 * UTC kickoff and both teams; it is not a replacement for provider event IDs.
 */
export function canonicalFixtureKey(input: Pick<CanonicalFixture,
  "homeTeamId" | "awayTeamId" | "competitionId" | "seasonId" | "kickoffUtc"
>): string | null {
  if (!input.homeTeamId.trim() || !input.awayTeamId.trim() ||
      !input.competitionId.trim() || !input.seasonId.trim() || !isIsoDate(input.kickoffUtc)) return null;
  if (input.homeTeamId === input.awayTeamId) return null;
  return [
    input.competitionId.trim().toLowerCase(),
    input.seasonId.trim().toLowerCase(),
    input.kickoffUtc,
    input.homeTeamId.trim().toLowerCase(),
    input.awayTeamId.trim().toLowerCase()
  ].join("|");
}

/** Probabilities must be finite, bounded, and sum to one within tolerance. */
export function validateProbabilityDistribution(
  probabilities: ProbabilityDistribution,
  tolerance = 0.005
): string[] {
  const errors: string[] = [];
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    errors.push("probabilities must be finite numbers between 0 and 1");
    return errors;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > tolerance) errors.push("home/draw/away probabilities must sum to 1");
  return errors;
}

/** A prediction may not use information retrieved after its stated data cutoff. */
export function validatePredictionSnapshot(prediction: PredictionSnapshot): string[] {
  const errors: string[] = [];
  if (!prediction.id.trim()) errors.push("prediction id is required");
  if (!prediction.fixtureId.trim()) errors.push("fixture id is required");
  if (!prediction.modelVersion.trim()) errors.push("model version is required");
  if (!isIsoDate(prediction.createdAt)) errors.push("prediction createdAt must be a timezone-aware ISO timestamp");
  if (!isIsoDate(prediction.dataCutoffUtc)) errors.push("data cutoff must be a timezone-aware ISO timestamp");
  if (isIsoDate(prediction.createdAt) && isIsoDate(prediction.dataCutoffUtc) &&
      Date.parse(prediction.dataCutoffUtc) > Date.parse(prediction.createdAt)) {
    errors.push("data cutoff cannot be later than prediction creation");
  }
  if (prediction.evidenceStatus === "withheld" && prediction.probabilities !== null) {
    errors.push("withheld predictions must not publish probabilities");
  }
  if (prediction.evidenceStatus !== "withheld" && prediction.probabilities === null) {
    errors.push("non-withheld predictions require a probability distribution");
  }
  if (prediction.probabilities) {
    errors.push(...validateProbabilityDistribution(prediction.probabilities));
  }
  return errors;
}

/** Keep bet recommendations disabled until an approved model and odds exist. */
export function canRecommendBet(input: {
  fixtureValid: boolean;
  evidenceFresh: boolean;
  sufficientHistory: boolean;
  calibratedOnHoldout: boolean;
  exactMarketOddsAvailable: boolean;
  modelApproved: boolean;
}): { allowed: boolean; reasons: string[] } {
  const checks: Array<[keyof typeof input, string]> = [
    ["fixtureValid", "fixture identity is not verified"],
    ["evidenceFresh", "required evidence is missing, stale or conflicting"],
    ["sufficientHistory", "historical sample is insufficient"],
    ["calibratedOnHoldout", "probabilities have not passed held-out calibration"],
    ["exactMarketOddsAvailable", "current odds for the exact market are unavailable"],
    ["modelApproved", "model version has not been approved"]
  ];
  const reasons = checks.filter(([key]) => !input[key]).map(([, reason]) => reason);
  return { allowed: reasons.length === 0, reasons };
}
