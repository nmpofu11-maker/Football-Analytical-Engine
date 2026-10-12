import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFixtureMergeKey } from "../src/unified/fixtureMergeKey";

const base = {
  homeTeam: "Manchester City",
  awayTeam: "Arsenal",
  date: "2026-10-17",
  competition: "Premier League",
  kickoffUtc: "2026-10-17T16:30:00Z",
};

describe("strict fixture merge identity", () => {
  it("merges the same fixture across provider name formatting", () => {
    assert.equal(
      buildFixtureMergeKey(base),
      buildFixtureMergeKey({ ...base, homeTeam: "Manchéster City", competition: " premier-league ", time: "16:30", kickoffUtc: undefined })
    );
  });

  it("keeps different competitions on the same date separate", () => {
    assert.notEqual(
      buildFixtureMergeKey(base),
      buildFixtureMergeKey({ ...base, competition: "FA Cup" })
    );
  });

  it("keeps separate kickoffs separate even for the same teams and competition", () => {
    assert.notEqual(
      buildFixtureMergeKey(base),
      buildFixtureMergeKey({ ...base, kickoffUtc: "2026-10-17T19:00:00Z" })
    );
  });

  it("rejects incomplete or self-playing fixture identity", () => {
    assert.equal(buildFixtureMergeKey({ ...base, homeTeam: "", awayTeam: "Arsenal" }), null);
    assert.equal(buildFixtureMergeKey({ ...base, homeTeam: "Arsenal", awayTeam: "arsenal" }), null);
  });
});
