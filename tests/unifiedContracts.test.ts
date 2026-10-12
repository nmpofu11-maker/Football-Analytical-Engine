import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canRecommendBet,
  canonicalFixtureKey,
  validateCanonicalFixture,
  validatePredictionSnapshot,
  validateProbabilityDistribution,
  type CanonicalFixture,
  type PredictionSnapshot,
} from "../src/unified/contracts";

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

  it("rejects missing identity and a team playing itself", () => {
    const invalid = { ...fixture, homeTeamId: "team-home", awayTeamId: "team-home", competitionId: "" };
    const errors = validateCanonicalFixture(invalid);
    assert.ok(errors.includes("home and away team ids must differ"));
    assert.ok(errors.includes("competition id is required"));
  });

  it("builds a stable reconciliation key from teams, competition, season and kickoff", () => {
    const key = canonicalFixtureKey(fixture);
    assert.equal(key, "league-1|2026|2026-10-17T16:30:00Z|team-home|team-away");
    assert.equal(canonicalFixtureKey({ ...fixture, kickoffUtc: "not-a-date" }), null);
    assert.notEqual(key, canonicalFixtureKey({ ...fixture, awayTeamId: "another-team" }));
  });

  it("rejects probabilities that are invalid or do not sum to one", () => {
    assert.deepEqual(validateProbabilityDistribution({ home: 0.5, draw: 0.25, away: 0.25 }), []);
    assert.ok(validateProbabilityDistribution({ home: 0.8, draw: 0.3, away: 0.1 }).length > 0);
    assert.ok(validateProbabilityDistribution({ home: 1.2, draw: -0.1, away: 0 }).length > 0);
  });

  it("rejects a prediction whose data cutoff is after prediction creation", () => {
    const prediction: PredictionSnapshot = {
      id: "prediction-1",
      fixtureId: fixture.id,
      createdAt: "2026-10-12T08:00:00Z",
      dataCutoffUtc: "2026-10-12T08:01:00Z",
      modelVersion: "baseline-v1",
      probabilities: { home: 0.45, draw: 0.3, away: 0.25 },
      evidenceStatus: "exploratory",
      reasons: ["Insufficient held-out calibration"],
    };
    assert.ok(validatePredictionSnapshot(prediction).includes("data cutoff cannot be later than prediction creation"));
  });

  it("does not allow a withheld prediction to publish probabilities", () => {
    const prediction: PredictionSnapshot = {
      id: "prediction-2",
      fixtureId: fixture.id,
      createdAt: "2026-10-12T08:00:00Z",
      dataCutoffUtc: "2026-10-12T07:59:00Z",
      modelVersion: "baseline-v1",
      probabilities: { home: 0.45, draw: 0.3, away: 0.25 },
      evidenceStatus: "withheld",
      reasons: ["No verified history"],
    };
    assert.ok(validatePredictionSnapshot(prediction).includes("withheld predictions must not publish probabilities"));
  });

  it("withholds bet recommendations unless every evidence gate passes", () => {
    const blocked = canRecommendBet({
      fixtureValid: true,
      evidenceFresh: true,
      sufficientHistory: false,
      calibratedOnHoldout: false,
      exactMarketOddsAvailable: true,
      modelApproved: false,
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reasons.length, 3);
    const approved = canRecommendBet({
      fixtureValid: true,
      evidenceFresh: true,
      sufficientHistory: true,
      calibratedOnHoldout: true,
      exactMarketOddsAvailable: true,
      modelApproved: true,
    });
    assert.deepEqual(approved, { allowed: true, reasons: [] });
  });
});
