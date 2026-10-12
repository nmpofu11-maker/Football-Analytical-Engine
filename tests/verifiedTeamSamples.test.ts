import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getVerifiedTeamSampleSize } from "../src/utils/verifiedTeamSamples";

describe("verified historical evidence gate", () => {
  it("counts only trusted, valid, non-conflicted result records", () => {
    const records = [
      { id: "a", matchKey: "a", homeTeam: "Team A", awayTeam: "Team B", actualScore: "2-1", source: "sportmonks", verifiedAt: "2026-10-10T12:00:00Z" },
      { id: "b", matchKey: "b", homeTeam: "Team A", awayTeam: "Team C", actualScore: "1-0", source: "sportapi-ai", verifiedAt: "2026-10-10T12:00:00Z" },
      { id: "c", matchKey: "c", homeTeam: "Team A", awayTeam: "Team D", actualScore: "0-0", source: "sportmonks", verificationStatus: "conflict", verifiedAt: "2026-10-10T12:00:00Z" },
      { id: "d", matchKey: "d", homeTeam: "Team A", awayTeam: "Team E", actualScore: "2-1", source: "manual-import", verifiedAt: "2026-10-10T12:00:00Z" },
    ];
    assert.equal(getVerifiedTeamSampleSize(records, "Team A", Date.parse("2026-10-12T00:00:00Z")), 2);
  });
});
