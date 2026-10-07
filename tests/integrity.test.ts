import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCKED_80_TEAMS } from "../src/data/favoriteTeams";
import { parseBookmakerRawText } from "../src/utils/bookmakerParser";
import { getFixtureCompositeKey } from "../src/utils/fixtureDedupe";
import { simulateMatchup } from "../src/utils/footballMath";

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
