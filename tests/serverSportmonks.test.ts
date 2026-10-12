import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSportmonksFixture } from "../src/services/serverSportmonks";

const now = new Date("2026-10-12T08:00:00Z");
const baseFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 9001,
  starting_at: "2026-10-17 16:30:00",
  participants: { data: [
    { id: 101, name: "Home FC", meta: { location: "home" } },
    { id: 202, name: "Away United", meta: { location: "away" } },
  ] },
  league: { data: { id: 39, name: "Example League" } },
  season_id: 2026,
  state: { data: { short_name: "NS", name: "Not Started" } },
  ...overrides,
});

describe("Sportmonks fixture normalization", () => {
  it("normalizes timezone-naive timestamps as UTC and preserves provider IDs", () => {
    const fixture = normalizeSportmonksFixture(baseFixture(), "2026-10-12T08:00:00Z", now);
    assert.ok(fixture);
    assert.equal(fixture.kickoffUtc, "2026-10-17T16:30:00.000Z");
    assert.equal(fixture.date, "2026-10-17");
    assert.equal(fixture.time, "16:30");
    assert.equal(fixture.homeTeamId, "101");
    assert.equal(fixture.awayTeamId, "202");
    assert.equal(fixture.competitionId, "39");
    assert.equal(fixture.seasonId, "2026");
    assert.equal(fixture.resultSettled, false);
    assert.equal(fixture.homeGoals, undefined);
    assert.equal(fixture.awayGoals, undefined);
  });

  it("does not accept a future fixture marked finished as a settled result", () => {
    const raw = baseFixture({
      state: { data: { short_name: "FT", name: "Finished" } },
      scores: { data: [
        { participant_id: 101, description: "CURRENT", score: { goals: 2, participant: "home" } },
        { participant_id: 202, description: "CURRENT", score: { goals: 1, participant: "away" } },
      ] },
    });
    const fixture = normalizeSportmonksFixture(raw, "2026-10-12T08:00:00Z", now);
    assert.ok(fixture);
    assert.equal(fixture.status, "NS");
    assert.equal(fixture.resultSettled, false);
    assert.equal(fixture.homeGoals, undefined);
  });

  it("accepts scores only when a past fixture has an explicit final status", () => {
    const raw = baseFixture({
      starting_at: "2026-10-10 16:30:00",
      state: { data: { short_name: "FT", name: "Finished" } },
      scores: { data: [
        { participant_id: 101, description: "CURRENT", score: { goals: 2, participant: "home" } },
        { participant_id: 202, description: "CURRENT", score: { goals: 1, participant: "away" } },
      ] },
    });
    const fixture = normalizeSportmonksFixture(raw, "2026-10-12T08:00:00Z", now);
    assert.ok(fixture);
    assert.equal(fixture.status, "FT");
    assert.equal(fixture.resultSettled, true);
    assert.equal(fixture.homeGoals, 2);
    assert.equal(fixture.awayGoals, 1);
  });

  it("rejects records missing team or competition identity", () => {
    assert.equal(normalizeSportmonksFixture({ id: 1, starting_at: "2026-10-17 16:30:00" }, undefined, now), null);
    assert.equal(normalizeSportmonksFixture(baseFixture({ league: null }), undefined, now), null);
  });
});
