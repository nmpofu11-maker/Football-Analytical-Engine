import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCKED_80_TEAMS } from "../src/data/favoriteTeams";
import { parseBookmakerRawText } from "../src/utils/bookmakerParser";
import { getFixtureCompositeKey, mergeFixtureSlates } from "../src/utils/fixtureDedupe";
import { getVerifiedTeamSampleSize } from "../src/utils/verifiedTeamSamples";
import { isValidIsoDate } from "../src/utils/isoDate";
import { simulateMatchup } from "../src/utils/footballMath";
import { fetchSportApiAiFixtures, getSportApiAiProviderDiagnostics } from "../src/services/serverSportApiAi";
import { fetchTheRundownFixtures, getTheRundownProviderDiagnostics, SOCCER_SPORT_IDS } from "../src/services/serverTheRundown";

describe("verified historical sample provenance", () => {
  it("counts only distinct settled results from recognized providers", () => {
    const records = [
      { id: "m1", homeTeam: "Napoli", awayTeam: "Roma", actualScore: "2-1", source: "api-football", verifiedAt: "2026-10-10T18:00:00Z" },
      { id: "m1", homeTeam: "Napoli", awayTeam: "Roma", actualScore: "2-1", source: "api-football", verifiedAt: "2026-10-10T18:00:00Z" },
      { id: "m2", homeTeam: "Roma", awayTeam: "Napoli", actualScore: "0-0", source: "sportmonks", verifiedAt: "2026-10-09T18:00:00Z" },
      { id: "manual", homeTeam: "Napoli", awayTeam: "Roma", actualScore: "4-0", source: "manual-ingest", verifiedAt: "2026-10-08T18:00:00Z" },
      { id: "unsettled", homeTeam: "Napoli", awayTeam: "Roma", actualScore: "N/A", source: "api-football", verifiedAt: "2026-10-08T18:00:00Z" }
    ];
    assert.equal(getVerifiedTeamSampleSize(records, "Napoli"), 2);
    assert.equal(getVerifiedTeamSampleSize(records, "Roma"), 2);
    assert.equal(getVerifiedTeamSampleSize(records, "Liverpool"), 0);
  });

  it("does not count malformed or future-dated result records", () => {
    const records = [
      { id: "bad-score", homeTeam: "Napoli", awayTeam: "Roma", actualScore: "TBD", source: "api-football", verifiedAt: "2026-10-08T18:00:00Z" },
      { id: "future", homeTeam: "Napoli", awayTeam: "Roma", actualScore: "1-0", source: "api-football", verifiedAt: "2999-01-01T00:00:00Z" }
    ];
    assert.equal(getVerifiedTeamSampleSize(records, "Napoli"), 0);
  });
});

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

  it("does not apply home advantage when derby context is unknown", () => {
    const coefficients = { home_advantage_multiplier: 1.12, form_momentum_weight: 1, volatility_index: 1, fatigue_penalty_modifier: 1 };
    const unknown = simulateMatchup(
      "Napoli", "FC Nantes", coefficients, coefficients,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 0, 0
    );
    const knownNonDerby = simulateMatchup(
      "Napoli", "FC Nantes", coefficients, coefficients,
      false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 0, 0
    );
    assert.ok(unknown.reasons.some(reason => reason.includes("Derby status unknown")));
    assert.ok(!unknown.reasons.some(reason => reason.includes("Home-advantage coefficient applied")));
    assert.ok(knownNonDerby.reasons.some(reason => reason.includes("Home-advantage coefficient applied")));
    assert.ok(unknown.homeExpectedGoals < knownNonDerby.homeExpectedGoals);
  });

  it("keeps displayed outcome probabilities between 0 and 100 and totaling exactly 100", () => {
    const coefficients = { home_advantage_multiplier: 1.08, form_momentum_weight: 1, volatility_index: 1, fatigue_penalty_modifier: 1 };
    const result = simulateMatchup(
      "Napoli", "FC Nantes", coefficients, coefficients,
      false, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 0, 0
    );
    const percentages = [result.homeWinProbability, result.drawProbability, result.awayWinProbability];
    assert.equal(percentages.reduce((sum, value) => sum + value, 0), 100);
    assert.ok(percentages.every(value => Number.isInteger(value) && value >= 0 && value <= 100));
  });

  it("blocks displayed prediction estimates when either team has no verified historical sample", () => {
    const coefficients = { home_advantage_multiplier: 1, form_momentum_weight: 1, volatility_index: 1, fatigue_penalty_modifier: 1 };
    const missingSamples = simulateMatchup(
      "Cardiff Metropolitan", "Barry Town United",
      coefficients, coefficients, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, 0, 0
    );
    const oneTeamMissing = simulateMatchup(
      "Cardiff Metropolitan", "Barry Town United",
      coefficients, coefficients, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, 8, 0
    );
    const bothHaveSamples = simulateMatchup(
      "Cardiff Metropolitan", "Barry Town United",
      coefficients, coefficients, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, 8, 6
    );
    assert.equal(missingSamples.evidenceGate, "blocked");
    assert.equal(oneTeamMissing.evidenceGate, "blocked");
    assert.equal(bothHaveSamples.evidenceGate, "open");
    assert.ok(missingSamples.reasons.some(reason => reason.includes("Prediction blocked")));
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
  it("uses the documented SportAPI.ai fixtures date endpoint and returns no fixtures on rejection", async () => {
    const oldKey = process.env.SPORTAPI_AI_KEY;
    const oldFetch = globalThis.fetch;
    let requestedUrl = "";
    process.env.SPORTAPI_AI_KEY = "test-key";
    globalThis.fetch = (async (input: any) => {
      requestedUrl = String(input);
      return new Response("unauthorized", { status: 401 });
    }) as typeof fetch;
    try {
      assert.deepEqual(await fetchSportApiAiFixtures("2026-10-10"), []);
      assert.equal(requestedUrl, "https://sportapi.ai/api/fixtures?date=2026-10-10");
      const diagnostics = getSportApiAiProviderDiagnostics();
      assert.equal(diagnostics.configured, true);
      assert.equal(diagnostics.state, "http_error");
      assert.equal(diagnostics.lastHttpStatus, 401);
      assert.equal(diagnostics.lastErrorCode, "http_401");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.SPORTAPI_AI_KEY;
      else process.env.SPORTAPI_AI_KEY = oldKey;
    }
  });

  it("uses TheRundown's documented soccer sport IDs", () => {
    assert.deepEqual(SOCCER_SPORT_IDS, [
      { id: 10, name: "MLS" },
      { id: 11, name: "Premier League" },
      { id: 12, name: "Ligue 1" },
      { id: 13, name: "Bundesliga" },
      { id: 14, name: "La Liga" },
      { id: 15, name: "Serie A" },
      { id: 16, name: "Champions League" },
      { id: 19, name: "J1 League" },
      { id: 34, name: "Liga MX" }
    ]);
  });

  it("rejects placeholder or incomplete SportAPI.ai fixtures", async () => {
    const oldKey = process.env.SPORTAPI_AI_KEY;
    const oldFetch = globalThis.fetch;
    process.env.SPORTAPI_AI_KEY = "test-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({ fixtures: [
      { id: "bad-home", home_team: "Home", away_team: "Liverpool", datetime: "2026-10-10T12:00:00Z" },
      { home_team: "Arsenal", away_team: "Chelsea", datetime: "2026-10-10T13:00:00Z" },
      { id: "missing-kickoff", home_team: "Napoli", away_team: "Roma" },
      { id: "valid", home_team: "Arsenal", away_team: "Chelsea", datetime: "2026-10-10T13:00:00Z", league: { id: 39, name: "Premier League" } },
      { id: "missing-competition", home_team: "Brighton", away_team: "West Ham", datetime: "2026-10-10T13:30:00Z" },
      { id: "placeholder-competition", home_team: "Everton", away_team: "Fulham", datetime: "2026-10-10T14:00:00Z", competition: "Competition unavailable" },
      { id: "scheduled-zero", home_team: "Liverpool", away_team: "Manchester City", datetime: "2026-10-10T15:00:00Z", status: "SCHEDULED", home_score: 0, away_score: 0, league: { id: 39, name: "Premier League" } },
      { id: "finished", home_team: "Napoli", away_team: "Roma", datetime: "2026-10-10T18:00:00Z", status: "FT", home_score: 2, away_score: 1, competition: { id: 135, name: "Serie A" } }
    ] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const fixtures = await fetchSportApiAiFixtures("2026-10-10");
      assert.equal(fixtures.length, 3);
      assert.equal(fixtures[0].id, "valid");
      assert.equal(fixtures[0].homeTeam, "Arsenal");
      assert.equal(fixtures[0].awayTeam, "Chelsea");
      assert.equal(fixtures[0].sourceConfidence, "verified");
      assert.equal(fixtures[0].competition, "Premier League");
      assert.ok(!fixtures.some(f => f.id === "missing-competition"));
      assert.ok(!fixtures.some(f => f.id === "placeholder-competition"));
      assert.ok(fixtures.every(f => f.competition && f.competition !== "Competition unavailable"));
      const scheduled = fixtures.find(f => f.id === "scheduled-zero")!;
      assert.equal(scheduled.competition, "Premier League");
      assert.equal(scheduled.status, "NS");
      assert.equal(scheduled.homeGoals, undefined);
      assert.equal(scheduled.awayGoals, undefined);
      assert.equal(scheduled.resultSettled, false);
      const finished = fixtures.find(f => f.id === "finished")!;
      assert.equal(finished.competition, "Serie A");
      assert.equal(finished.homeGoals, 2);
      assert.equal(finished.awayGoals, 1);
      assert.equal(finished.resultSettled, true);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.SPORTAPI_AI_KEY;
      else process.env.SPORTAPI_AI_KEY = oldKey;
    }
  });

  it("downgrades a future SportAPI.ai fixture incorrectly marked final with 0-0", async () => {
    const oldKey = process.env.SPORTAPI_AI_KEY;
    const oldFetch = globalThis.fetch;
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const date = future.toISOString().slice(0, 10);
    process.env.SPORTAPI_AI_KEY = "test-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({ fixtures: [
      { id: "future-final", home_team: "Liverpool", away_team: "Manchester City", datetime: future.toISOString(), status: "FT", home_score: 0, away_score: 0, league: { name: "Premier League" } }
    ] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const fixtures = await fetchSportApiAiFixtures(date);
      assert.equal(fixtures.length, 1);
      assert.equal(fixtures[0].status, "NS");
      assert.equal(fixtures[0].homeGoals, undefined);
      assert.equal(fixtures[0].awayGoals, undefined);
      assert.equal(fixtures[0].resultSettled, false);
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
      { event_id: "valid", event_date: "2026-10-10T14:00:00Z", teams: [{ is_home: true, name: "Arsenal" }, { is_home: false, name: "Chelsea" }] },
      { event_id: "scheduled-zero", event_date: "2026-10-10T15:00:00Z", status_type: "STATUS_SCHEDULED", score: { score_home: 0, score_away: 0, event_status: "STATUS_SCHEDULED" }, teams: [{ is_home: true, name: "Liverpool" }, { is_home: false, name: "Manchester City" }] },
      { event_id: "finished", event_date: "2026-10-10T16:00:00Z", status_type: "STATUS_FINAL", score: { score_home: 2, score_away: 1, event_status: "STATUS_FINAL" }, teams: [{ is_home: true, name: "Napoli" }, { is_home: false, name: "Roma" }] }
    ] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const fixtures = await fetchTheRundownFixtures("2026-10-10");
      assert.ok(fixtures.length >= 1);
      assert.ok(fixtures.every(f => f.homeTeam !== "Home" && f.awayTeam !== "Away" && f.id));
      assert.ok(fixtures.some(f => f.id === "valid"));
      const scheduled = fixtures.find(f => f.id === "scheduled-zero")!;
      assert.equal(scheduled.status, "NS");
      assert.equal(scheduled.homeGoals, undefined);
      assert.equal(scheduled.awayGoals, undefined);
      assert.equal(scheduled.resultSettled, false);
      const finished = fixtures.find(f => f.id === "finished")!;
      assert.equal(finished.homeGoals, 2);
      assert.equal(finished.awayGoals, 1);
      assert.equal(finished.resultSettled, true);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.THERUNDOWN_KEY;
      else process.env.THERUNDOWN_KEY = oldKey;
    }
  });

  it("caches successful TheRundown fixture responses to avoid repeated competition requests", async () => {
    const oldKey = process.env.THERUNDOWN_KEY;
    const oldFetch = globalThis.fetch;
    let calls = 0;
    const date = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    process.env.THERUNDOWN_KEY = "test-key";
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      assert.deepEqual(await fetchTheRundownFixtures(date), []);
      assert.equal(calls, SOCCER_SPORT_IDS.length);
      assert.deepEqual(await fetchTheRundownFixtures(date), []);
      assert.equal(calls, SOCCER_SPORT_IDS.length);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.THERUNDOWN_KEY;
      else process.env.THERUNDOWN_KEY = oldKey;
    }
  });

  it("backs off after TheRundown rate limiting instead of calling every competition", async () => {
    const oldKey = process.env.THERUNDOWN_KEY;
    const oldFetch = globalThis.fetch;
    let calls = 0;
    process.env.THERUNDOWN_KEY = "test-key";
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch;
    try {
      const fixtures = await fetchTheRundownFixtures("2026-10-11");
      assert.deepEqual(fixtures, []);
      assert.equal(calls, 1);
      const duringCooldown = await fetchTheRundownFixtures("2026-10-11");
      assert.deepEqual(duringCooldown, []);
      assert.equal(calls, 1);
      const diagnostics = getTheRundownProviderDiagnostics();
      assert.equal(diagnostics.configured, true);
      assert.equal(diagnostics.state, "rate_limited");
      assert.equal(diagnostics.lastHttpStatus, 429);
      assert.ok(diagnostics.cooldownUntil);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.THERUNDOWN_KEY;
      else process.env.THERUNDOWN_KEY = oldKey;
    }
  });
});

describe("scheduled fixture merge integrity", () => {
  it("clears stale scorelines when a scheduled provider refresh omits scores", () => {
    const existing = [{
      id: "sportapi-1", date: "2026-10-12", time: "18:00",
      homeTeam: "Liverpool", awayTeam: "Manchester City", competition: "Premier League",
      status: "NS" as const, finalScore: { home: 0, away: 0 }, homeGoals: 0, awayGoals: 0, resultSettled: false,
      source: "sportapi-ai", sourceConfidence: "verified" as const, ingestedAt: "2026-10-11T08:00:00.000Z"
    }];
    const incoming = [{
      id: "rundown-1", date: "2026-10-12", time: "18:00",
      homeTeam: "Liverpool", awayTeam: "Manchester City", competition: "Premier League",
      status: "NS" as const, resultSettled: false, source: "therundown",
      sourceConfidence: "verified" as const, ingestedAt: "2026-10-11T09:00:00.000Z"
    }];
    const merged = mergeFixtureSlates(existing, incoming);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].status, "NS");
    assert.equal(merged[0].finalScore, undefined);
    assert.equal((merged[0] as any).homeGoals, undefined);
    assert.equal((merged[0] as any).awayGoals, undefined);
  });

  it("preserves a result explicitly marked as settled", () => {
    const existing = [{
      id: "sportapi-finished", date: "2026-10-10", time: "18:00",
      homeTeam: "Napoli", awayTeam: "Roma", competition: "Serie A",
      status: "FT" as const, finalScore: { home: 2, away: 1 }, resultSettled: true,
      settledAt: "2026-10-10T20:00:00.000Z", source: "sportapi-ai",
      sourceConfidence: "verified" as const, ingestedAt: "2026-10-10T20:01:00.000Z"
    }];
    const incoming = [{
      id: "rundown-stale-schedule", date: "2026-10-10", time: "18:00",
      homeTeam: "Napoli", awayTeam: "Roma", competition: "Serie A",
      status: "NS" as const, resultSettled: false, source: "therundown",
      sourceConfidence: "verified" as const, ingestedAt: "2026-10-11T09:00:00.000Z"
    }];
    const merged = mergeFixtureSlates(existing, incoming);
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].finalScore, { home: 2, away: 1 });
    assert.equal(merged[0].resultSettled, true);
  });
});

describe("ISO calendar date validation", () => {
  it("accepts valid YYYY-MM-DD dates and rejects malformed or impossible dates", () => {
    assert.equal(isValidIsoDate("2026-10-11"), true);
    assert.equal(isValidIsoDate("2024-02-29"), true);
    assert.equal(isValidIsoDate("2026-02-29"), false);
    assert.equal(isValidIsoDate("2026-13-01"), false);
    assert.equal(isValidIsoDate("11-10-2026"), false);
    assert.equal(isValidIsoDate("2026-1-01"), false);
    assert.equal(isValidIsoDate(""), false);
    assert.equal(isValidIsoDate(null), false);
  });
});
