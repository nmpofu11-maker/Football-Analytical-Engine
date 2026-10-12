import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconcileFinalScoreObservations, reconcileFixtureCandidates, type FixtureCandidate } from "../src/unified/reconciliation";

const candidate = (overrides: Partial<FixtureCandidate> = {}): FixtureCandidate => ({
  provider: "sportmonks",
  providerEventId: "sm-100",
  homeTeamId: "team-a",
  awayTeamId: "team-b",
  competitionId: "league-x",
  seasonId: "2026",
  kickoffUtc: "2026-10-17T16:30:00Z",
  status: "scheduled",
  retrievedAt: "2026-10-12T08:00:00Z",
  ...overrides,
});

describe("provider fixture reconciliation", () => {
  it("merges cross-provider observations only when canonical identity agrees", () => {
    const result = reconcileFixtureCandidates([
      candidate(),
      candidate({ provider: "sportapi-ai", providerEventId: "sa-200" }),
    ]);
    assert.equal(result.fixtures.length, 1);
    assert.equal(result.fixtures[0]?.observations.length, 2);
    assert.deepEqual(result.fixtures[0]?.providerEventIds, {
      sportmonks: "sm-100",
      "sportapi-ai": "sa-200",
    });
    assert.equal(result.fixtures[0]?.eligibleForPrediction, true);
    assert.deepEqual(result.fixtures[0]?.conflicts, []);
  });

  it("keeps different competitions separate", () => {
    const result = reconcileFixtureCandidates([
      candidate(),
      candidate({ provider: "sportapi-ai", providerEventId: "sa-201", competitionId: "league-y" }),
    ]);
    assert.equal(result.fixtures.length, 2);
  });

  it("does not merge a fixture with the home and away teams reversed", () => {
    const result = reconcileFixtureCandidates([
      candidate(),
      candidate({ provider: "sportapi-ai", providerEventId: "sa-202", homeTeamId: "team-b", awayTeamId: "team-a" }),
    ]);
    assert.equal(result.fixtures.length, 2);
  });

  it("blocks prediction eligibility when providers disagree on kickoff", () => {
    const result = reconcileFixtureCandidates([
      candidate(),
      candidate({ provider: "sportapi-ai", providerEventId: "sa-203", kickoffUtc: "2026-10-17T16:40:00Z" }),
    ]);
    assert.equal(result.fixtures.length, 1);
    assert.equal(result.fixtures[0]?.eligibleForPrediction, false);
    assert.ok(result.fixtures[0]?.conflicts.some(reason => reason.includes("kickoff times disagree")));
  });

  it("flags a provider event id reused for different fixture identities", () => {
    const result = reconcileFixtureCandidates([
      candidate(),
      candidate({ homeTeamId: "team-c", awayTeamId: "team-d" }),
    ]);
    assert.equal(result.fixtures.length, 2);
    assert.ok(result.fixtures.every(fixture => fixture.eligibleForPrediction === false));
    assert.ok(result.fixtures.every(fixture => fixture.conflicts.some(reason => reason.includes("maps to multiple fixture identities"))));
  });

  it("rejects incomplete candidates rather than manufacturing an identity", () => {
    const result = reconcileFixtureCandidates([
      candidate({ providerEventId: "", competitionId: "" }),
    ]);
    assert.equal(result.fixtures.length, 0);
    assert.equal(result.rejected.length, 1);
    assert.ok(result.rejected[0]?.reasons.includes("provider event id is required"));
    assert.ok(result.rejected[0]?.reasons.includes("canonical competition id is required"));
  });
});


describe("verified final score reconciliation", () => {
  it("accepts corroborating identical final scores", () => {
    assert.deepEqual(reconcileFinalScoreObservations([
      { provider: "sportapi-ai", resultSettled: true, homeGoals: 2, awayGoals: 1 },
      { provider: "sportmonks", resultSettled: true, homeGoals: 2, awayGoals: 1 },
    ]), { status: "verified", homeGoals: 2, awayGoals: 1, sources: ["sportapi-ai", "sportmonks"] });
  });

  it("blocks settlement when trusted providers disagree", () => {
    const result = reconcileFinalScoreObservations([
      { provider: "sportapi-ai", resultSettled: true, homeGoals: 2, awayGoals: 1 },
      { provider: "sportmonks", resultSettled: true, homeGoals: 1, awayGoals: 0 },
    ]);
    assert.equal(result.status, "conflict");
    if (result.status === "conflict") assert.equal(result.scores.length, 2);
  });

  it("does not treat provisional or malformed scores as verified final results", () => {
    assert.deepEqual(reconcileFinalScoreObservations([
      { provider: "sportapi-ai", resultSettled: false, homeGoals: 0, awayGoals: 0 },
      { provider: "sportmonks", resultSettled: true, homeGoals: "TBD", awayGoals: 1 },
    ]), { status: "missing", reason: "No provider supplied a validated final score." });
  });
});
