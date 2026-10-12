/**
 * Canonical contracts and integrity gates for the unified football platform.
 * No provider/network calls and no fabricated defaults belong in this module.
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
  id: string; homeTeamId: string; awayTeamId: string; competitionId: string;
  seasonId: string; kickoffUtc: string; status: FixtureStatus; providerEventIds: Record<string, string>;
}
export interface ProviderObservation<T> {
  fixtureId: string; provider: string; retrievedAt: string; status: EvidenceStatus;
  value?: T; reason?: string; provenance: Provenance;
}
export interface MatchResult {
  fixtureId: string; homeGoals: number; awayGoals: number; status: "verified-final";
  verifiedAt: string; provenance: Provenance[];
}
export interface OddsSnapshot {
  fixtureId: string; market: string; selectionOdds: Record<string, number | null>;
  capturedAt: string; bookmaker: string; provenance: Provenance;
}
export interface ProbabilityDistribution { home: number; draw: number; away: number; }
export interface PredictionSnapshot {
  id: string; fixtureId: string; kickoffUtc: string; createdAt: string; dataCutoffUtc: string;
  modelVersion: string; probabilities: ProbabilityDistribution | null;
  evidenceStatus: "eligible" | "exploratory" | "withheld"; reasons: string[];
}
export interface ModelVersion {
  id: string; createdAt: string; trainingCutoffUtc: string;
  evaluationWindowStartUtc: string; evaluationWindowEndUtc: string;
  metrics: { logLoss?: number; brierScore?: number; sampleSize: number }; approved: boolean;
}

const isIsoDate = (value: string): boolean =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const isUtcIsoDate = (value: string): boolean => isIsoDate(value) && value.endsWith("Z");

export function validateCanonicalFixture(fixture: CanonicalFixture): string[] {
  const errors: string[] = [];
  if (!fixture.id.trim()) errors.push("fixture id is required");
  if (!fixture.homeTeamId.trim()) errors.push("home team id is required");
  if (!fixture.awayTeamId.trim()) errors.push("away team id is required");
  if (fixture.homeTeamId.trim().toLowerCase() === fixture.awayTeamId.trim().toLowerCase()) errors.push("home and away team ids must differ");
  if (!fixture.competitionId.trim()) errors.push("competition id is required");
  if (!fixture.seasonId.trim()) errors.push("season id is required");
  if (!isUtcIsoDate(fixture.kickoffUtc)) errors.push("kickoff must be a UTC ISO timestamp ending in Z");
  if (!fixture.status) errors.push("fixture status is required");
  return errors;
}

/** Fallback reconciliation key; provider event IDs remain the preferred identity. */
export function canonicalFixtureKey(input: Pick<CanonicalFixture,
  "homeTeamId" | "awayTeamId" | "competitionId" | "seasonId" | "kickoffUtc"
>): string | null {
  if (!input.homeTeamId.trim() || !input.awayTeamId.trim() ||
      !input.competitionId.trim() || !input.seasonId.trim() || !isIsoDate(input.kickoffUtc)) return null;
  if (input.homeTeamId.trim().toLowerCase() === input.awayTeamId.trim().toLowerCase()) return null;
  return [
    input.competitionId.trim().toLowerCase(), input.seasonId.trim().toLowerCase(),
    new Date(input.kickoffUtc).toISOString(), input.homeTeamId.trim().toLowerCase(),
    input.awayTeamId.trim().toLowerCase()
  ].join("|");
}

export function validateProvenance(provenance: Provenance): string[] {
  const errors: string[] = [];
  if (!provenance.provider.trim()) errors.push("provenance provider is required");
  if (!isIsoDate(provenance.retrievedAt)) errors.push("provenance retrievedAt must be a timezone-aware ISO timestamp");
  return errors;
}

export function validateProviderObservation<T>(observation: ProviderObservation<T>): string[] {
  const errors: string[] = [];
  if (!observation.fixtureId.trim()) errors.push("observation fixture id is required");
  if (!observation.provider.trim()) errors.push("observation provider is required");
  if (!isIsoDate(observation.retrievedAt)) errors.push("observation retrievedAt must be a timezone-aware ISO timestamp");
  if (observation.status === "verified" && observation.value === undefined) errors.push("verified observation requires a value");
  if (observation.status !== "verified" && observation.value === undefined && !observation.reason?.trim()) errors.push("non-verified observation without a value requires a reason");
  errors.push(...validateProvenance(observation.provenance));
  return errors;
}

export function validateMatchResult(result: MatchResult): string[] {
  const errors: string[] = [];
  if (!result.fixtureId.trim()) errors.push("result fixture id is required");
  if (!Number.isInteger(result.homeGoals) || result.homeGoals < 0) errors.push("home goals must be a non-negative integer");
  if (!Number.isInteger(result.awayGoals) || result.awayGoals < 0) errors.push("away goals must be a non-negative integer");
  if (!isIsoDate(result.verifiedAt)) errors.push("result verifiedAt must be a timezone-aware ISO timestamp");
  if (result.status !== "verified-final") errors.push("only verified final results may be settled");
  if (result.provenance.length === 0) errors.push("result provenance is required");
  for (const source of result.provenance) errors.push(...validateProvenance(source));
  return errors;
}

export function validateOddsSnapshot(snapshot: OddsSnapshot): string[] {
  const errors: string[] = [];
  if (!snapshot.fixtureId.trim()) errors.push("odds fixture id is required");
  if (!snapshot.market.trim()) errors.push("odds market is required");
  if (!snapshot.bookmaker.trim()) errors.push("bookmaker is required");
  if (!isIsoDate(snapshot.capturedAt)) errors.push("odds capturedAt must be a timezone-aware ISO timestamp");
  const values = Object.values(snapshot.selectionOdds);
  if (values.length === 0) errors.push("at least one market selection is required");
  if (values.some(value => value !== null && (!Number.isFinite(value) || value <= 1))) errors.push("available decimal odds must be finite and greater than 1");
  if (values.every(value => value === null)) errors.push("all market odds are missing");
  errors.push(...validateProvenance(snapshot.provenance));
  return errors;
}

export function validateProbabilityDistribution(probabilities: ProbabilityDistribution, tolerance = 0.005): string[] {
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return ["probabilities must be finite numbers between 0 and 1"];
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > tolerance
    ? ["home/draw/away probabilities must sum to 1"] : [];
}

export function validatePredictionSnapshot(prediction: PredictionSnapshot): string[] {
  const errors: string[] = [];
  if (!prediction.id.trim()) errors.push("prediction id is required");
  if (!prediction.fixtureId.trim()) errors.push("fixture id is required");
  if (!prediction.modelVersion.trim()) errors.push("model version is required");
  if (!isIsoDate(prediction.createdAt)) errors.push("prediction createdAt must be a timezone-aware ISO timestamp");
  if (!isIsoDate(prediction.dataCutoffUtc)) errors.push("data cutoff must be a timezone-aware ISO timestamp");
  if (!isUtcIsoDate(prediction.kickoffUtc)) errors.push("prediction kickoff must be a UTC ISO timestamp ending in Z");
  if (isIsoDate(prediction.createdAt) && isIsoDate(prediction.dataCutoffUtc) &&
      Date.parse(prediction.dataCutoffUtc) > Date.parse(prediction.createdAt)) errors.push("data cutoff cannot be later than prediction creation");
  if (isIsoDate(prediction.createdAt) && isUtcIsoDate(prediction.kickoffUtc) &&
      Date.parse(prediction.createdAt) >= Date.parse(prediction.kickoffUtc)) errors.push("pre-match prediction must be created before kickoff");
  if (isIsoDate(prediction.dataCutoffUtc) && isUtcIsoDate(prediction.kickoffUtc) &&
      Date.parse(prediction.dataCutoffUtc) > Date.parse(prediction.kickoffUtc)) errors.push("data cutoff cannot be after kickoff");
  if (prediction.evidenceStatus === "withheld" && prediction.probabilities !== null) errors.push("withheld predictions must not publish probabilities");
  if (prediction.evidenceStatus !== "withheld" && prediction.probabilities === null) errors.push("non-withheld predictions require a probability distribution");
  if (prediction.probabilities) errors.push(...validateProbabilityDistribution(prediction.probabilities));
  return errors;
}

export function canRecommendBet(input: {
  fixtureValid: boolean; evidenceFresh: boolean; sufficientHistory: boolean;
  calibratedOnHoldout: boolean; exactMarketOddsAvailable: boolean; modelApproved: boolean;
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
