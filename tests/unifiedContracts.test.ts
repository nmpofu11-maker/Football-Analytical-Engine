import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canRecommendBet,
  canonicalFixtureKey,
  validateCanonicalFixture,
  validateMatchResult,
  validateOddsSnapshot,
  validatePredictionSnapshot,
  validateProbabilityDistribution,
  validateProviderObservation,
  type CanonicalFixture,
  type PredictionSnapshot,
  type Provenance,
} from "../src/unified/contracts";

const source: Provenance = {
  provider: "sportmonks",
  providerEventId: "sm-123",
  retrievedAt: "2026-10-12T07:00:00Z",
};

const fixture: CanonicalFixture = {
  id: "fixture-123",
  homeTeamId: "team-home",
  awayTeamId: "team-away",
  competitionId: "league-1",
  seasonId: "2026",
  kickoffUtc: "2026-10-17T16:30:00Z",
  status: "scheduled",
  providerEventIds: { sportmonks: "sm-123", "sportapi-ai": "sa-987" },
};

describe("unified canonical evidence contracts", () => {
  it("accepts a complete canonical fixture", () => {
    assert.deepEqual(validateCanonicalFixture(fixture), []);
  });

  it("rejects missing identity, a team playing itself and non-UTC kickoff", () => {
    const invalid = { ...fixture, homeTeamId: "team-home", awayTeamId: "team-home", competitionId: "", kickoffUtc: "2026-10-17T18:30:00+02:00" };
    const errors = validateCanonicalFixture(invalid);
    assert.ok(errors.includes("home and away team ids must differ"));
    assert.ok(errors.includes("competition id is required"));
    assert.ok(errors.includes("kickoff must be a UTC ISO timestamp ending in Z"));
  });

  it("normalizes equivalent timezone offsets for reconciliation", () => {
    const utcKey = canonicalFixtureKey(fixture);
    const offsetKey = canonicalFixtureKey({ ...fixture, kickoffUtc: "2026-10-17T18:30:00+02:00" });
    assert.equal(utcKey, "league-1|2026|2026-10-17T16:30:00.000Z|team-home|team-away");
    assert.equal(offsetKey, utcKey);
    assert.equal(canonicalFixtureKey({ ...fixture, kickoffUtc: "not-a-date" }), null);
    assert.notEqual(utcKey, canonicalFixtureKey({ ...fixture, awayTeamId: "another-team" }));
  });

  it("requires a value for verified observations and a reason for missing evidence", () => {
    const verified = {
      fixtureId: fixture.id, provider: "sportmonks", retrievedAt: source.retrievedAt,
      status: "verified" as const, value: { goals: 2 }, provenance: source,
    };
    assert.deepEqual(validateProviderObservation(verified), []);
    assert.ok(validateProviderObservation({ ...verified, value: undefined }).includes("verified observation requires a value"));
    assert.ok(validateProviderObservation({ ...verified, status: "missing" as const, value: undefined, reason: "" })
      .includes("non-verified observation without a value requires a reason"));
  });

  it("rejects invalid result scores and requires provenance", () => {
    const result = {
      fixtureId: fixture.id, homeGoals: 2, awayGoals: 1,
      status: "verified-final" as const, verifiedAt: source.retrievedAt, provenance: [source],
    };
    assert.deepEqual(validateMatchResult(result), []);
    assert.ok(validateMatchResult({ ...result, homeGoals: 1.5, provenance: [] }).length >= 2);
  });

  it("rejects odds that are missing or not valid decimal prices", () => {
    const odds = {
      fixtureId: fixture.id, market: "1X2", selectionOdds: { home: 1.8, draw: 3.4, away: 4.5 },
      capturedAt: source.retrievedAt, bookmaker: "test-bookmaker", provenance: source,
    };
    assert.deepEqual(validateOddsSnapshot(odds), []);
    assert.ok(validateOddsSnapshot({ ...odds, selectionOdds: { home: 1, draw: null, away: -2 } }).length > 0);
    assert.ok(validateOddsSnapshot({ ...odds, selectionOdds: { home: null, draw: null, away: null } }).length > 0);
  });

  it("rejects probabilities that are invalid or do not sum to one", () => {
    assert.deepEqual(validateProbabilityDistribution({ home: 0.5, draw: 0.25, away: 0.25 }), []);
    assert.ok(validateProbabilityDistribution({ home: 0.8, draw: 0.3, away: 0.1 }).length > 0);
    assert.ok(validateProbabilityDistribution({ home: 1.2, draw: -0.1, away: 0 }).length > 0);
  });

  it("rejects a prediction whose data cutoff is after prediction creation", () => {
    const prediction: PredictionSnapshot = {
      id: "prediction-1", fixtureId: fixture.id,
      createdAt: "2026-10-12T08:00:00Z", dataCutoffUtc: "2026-10-12T08:01:00Z",
      modelVersion: "baseline-v1", probabilities: { home: 0.45, draw: 0.3, away: 0.25 },
      evidenceStatus: "exploratory", reasons: ["Insufficient held-out calibration"],
    };
    assert.ok(validatePredictionSnapshot(prediction).includes("data cutoff cannot be later than prediction creation"));
  });

  it("does not allow a withheld prediction to publish probabilities", () => {
    const prediction: PredictionSnapshot = {
      id: "prediction-2", fixtureId: fixture.id,
      createdAt: "2026-10-12T08:00:00Z", dataCutoffUtc: "2026-10-12T07:59:00Z",
      modelVersion: "baseline-v1", probabilities: { home: 0.45, draw: 0.3, away: 0.25 },
      evidenceStatus: "withheld", reasons: ["No verified history"],
    };
    assert.ok(validatePredictionSnapshot(prediction).includes("withheld predictions must not publish probabilities"));
  });

  it("withholds bet recommendations unless every evidence gate passes", () => {
    const blocked = canRecommendBet({
      fixtureValid: true, evidenceFresh: true, sufficientHistory: false,
      calibratedOnHoldout: false, exactMarketOddsAvailable: true, modelApproved: false,
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reasons.length, 3);
    const approved = canRecommendBet({
      fixtureValid: true, evidenceFresh: true, sufficientHistory: true,
      calibratedOnHoldout: true, exactMarketOddsAvailable: true, modelApproved: true,
    });
    assert.deepEqual(approved, { allowed: true, reasons: [] });
  });
});
