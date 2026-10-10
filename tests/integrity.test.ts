import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCKED_80_TEAMS } from "../src/data/favoriteTeams";
import { parseBookmakerRawText } from "../src/utils/bookmakerParser";
import { getFixtureCompositeKey } from "../src/utils/fixtureDedupe";
import { simulateMatchup } from "../src/utils/footballMath";
import { fetchSportApiAiFixtures } from "../src/services/serverSportApiAi";
import { fetchTheRundownFixtures } from "../src/services/serverTheRundown";

describe("integrity guards", () => {
  it("contains exactly 80 unique target teams", () => {
    assert.equal(LOCKED_80_TEAMS.length, 80);
    assert.equal(new Set(LOCKED_80_TEAMS).size, 80);
  });

  it("keeps bookmaker odds separate from football context inputs", () => {
    const parsed = parseBookmakerRawText(
      "Napoli vs FC Nantes 20:45 1.55 3.90 5.40 Serie A",
      "2026-10-07"
    );
    assert.equal(parsed.matches.length, 1);
    const fixture = parsed.matches[0].fixture;
    assert.deepEqual(fixture.odds, { home: 1.55, draw: 3.9, away: 5.4 });
    assert.equal(fixture.homeRank, undefined);
    assert.equal(fixture.awayRank, undefined);
    assert.equal(fixture.possessionRatio, undefined);
    assert.equal(fixture.opponentLowBlock, undefined);
    assert.equal(fixture.hasHighShotAccuracy, undefined);
  });

  it("does not invent bookmaker odds when none are supplied", () => {
    const parsed = parseBookmakerRawText(
      "Napoli vs FC Nantes 20:45 Serie A",
      "2026-10-07"
    );
    assert.equal(parsed.matches.length, 0);
    assert.ok(parsed.unparsedLines.length >= 1);
  });

  it("does not report heuristic confidence from sample counts", () => {
    const result = simulateMatchup(
      "Napoli", "FC Nantes",
      { home_advantage_multiplier: 1, form_momentum_weight: 1, volatility_index: 1, fatigue_penalty_modifier: 1 },
      { home_advantage_multiplier: 1, form_momentum_weight: 1, volatility_index: 1, fatigue_penalty_modifier: 1 },
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 0, 0
    );
    assert.equal(result.confidencePercentage, null);
    assert.equal(result.confidenceStatus, "insufficient-data");
    assert.ok(result.reasons.some(r => r.includes("Standing ranks unavailable")));
  });

  it("does not collapse distinct clubs by removing City/United", () => {
    assert.notEqual(
      getFixtureCompositeKey("Manchester City", "Liverpool", "2026-10-07"),
      getFixtureCompositeKey("Manchester United", "Liverpool", "2026-10-07")
    );
  });
});

describe("live provider validation", () => {
  it("returns no fixtures when SportAPI.ai rejects the request", async () => {
    const oldKey = process.env.SPORTAPI_AI_KEY;
    const oldFetch = globalThis.fetch;
    process.env.SPORTAPI_AI_KEY = "test-key";
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;
    try {
      assert.deepEqual(await fetchSportApiAiFixtures("2026-10-10"), []);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.SPORTAPI_AI_KEY;
      else process.env.SPORTAPI_AI_KEY = oldKey;
    }
  });

  it("rejects placeholder or incomplete SportAPI.ai fixtures", async () => {
    const oldKey = process.env.SPORTAPI_AI_KEY;
    const oldFetch = globalThis.fetch;
    process.env.SPORTAPI_AI_KEY = "test-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({ fixtures: [
      { id: "bad-home", home_team: "Home", away_team: "Liverpool", datetime: "2026-10-10T12:00:00Z" },
      { home_team: "Arsenal", away_team: "Chelsea", datetime: "2026-10-10T13:00:00Z" },
      { id: "missing-kickoff", home_team: "Napoli", away_team: "Roma" },
      { id: "valid", home_team: "Arsenal", away_team: "Chelsea", datetime: "2026-10-10T13:00:00Z" }
    ] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const fixtures = await fetchSportApiAiFixtures("2026-10-10");
      assert.equal(fixtures.length, 1);
      assert.equal(fixtures[0].id, "valid");
      assert.equal(fixtures[0].homeTeam, "Arsenal");
      assert.equal(fixtures[0].awayTeam, "Chelsea");
      assert.equal(fixtures[0].sourceConfidence, "verified");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.SPORTAPI_AI_KEY;
      else process.env.SPORTAPI_AI_KEY = oldKey;
    }
  });

  it("rejects TheRundown events with missing teams or event identifiers", async () => {
    const oldKey = process.env.THERUNDOWN_KEY;
    const oldFetch = globalThis.fetch;
    process.env.THERUNDOWN_KEY = "test-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({ events: [
      { event_id: "bad", event_date: "2026-10-10T12:00:00Z", teams: [{ is_home: true, name: "Home" }, { is_home: false, name: "Liverpool" }] },
      { event_date: "2026-10-10T13:00:00Z", teams: [{ is_home: true, name: "Arsenal" }, { is_home: false, name: "Chelsea" }] },
      { event_id: "valid", event_date: "2026-10-10T14:00:00Z", teams: [{ is_home: true, name: "Arsenal" }, { is_home: false, name: "Chelsea" }] }
    ] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const fixtures = await fetchTheRundownFixtures("2026-10-10");
      assert.ok(fixtures.length >= 1);
      assert.ok(fixtures.every(f => f.homeTeam !== "Home" && f.awayTeam !== "Away" && f.id));
      assert.ok(fixtures.some(f => f.id === "valid"));
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.THERUNDOWN_KEY;
      else process.env.THERUNDOWN_KEY = oldKey;
    }
  });
});
