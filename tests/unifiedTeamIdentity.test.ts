import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTeamName, resolveTeamIdentity, type CanonicalTeamIdentity } from "../src/unified/teamIdentity";

const teams: CanonicalTeamIdentity[] = [
  { id: "team-manchester-city", canonicalName: "Manchester City", aliases: ["Man City"], providerIds: { sportmonks: "101", "sportapi-ai": "mc-1" } },
  { id: "team-manchester-united", canonicalName: "Manchester United", aliases: ["Man United", "Man Utd"], providerIds: { sportmonks: "102" } },
  { id: "team-athletic", canonicalName: "Athletic Bilbao", aliases: ["Athletic Club"], providerIds: { sportmonks: "103" } },
];

describe("canonical team identity resolution", () => {
  it("normalizes accents and club prefixes without collapsing City and United", () => {
    assert.equal(normalizeTeamName("FC Barcelona"), "barcelona");
    assert.equal(normalizeTeamName("Athlétic Club"), "athleticclub");
    assert.notEqual(normalizeTeamName("Manchester City"), normalizeTeamName("Manchester United"));
  });

  it("prefers an explicit provider team ID when the name agrees", () => {
    assert.deepEqual(resolveTeamIdentity("sportmonks", "101", "Manchester City", teams), {
      status: "resolved", teamId: "team-manchester-city", method: "provider-id",
    });
  });

  it("resolves an explicitly configured exact alias when no provider ID is known", () => {
    assert.deepEqual(resolveTeamIdentity("unknown-provider", undefined, "Man Utd", teams), {
      status: "resolved", teamId: "team-manchester-united", method: "exact-alias",
    });
  });

  it("refuses to resolve when the provider ID and team name disagree", () => {
    const result = resolveTeamIdentity("sportmonks", "101", "Manchester United", teams);
    assert.equal(result.status, "conflict");
    if (result.status === "conflict") assert.ok(result.reason.includes("disagree"));
  });

  it("does not guess unknown teams or choose between ambiguous aliases", () => {
    assert.deepEqual(resolveTeamIdentity("unknown-provider", undefined, "Manchester Rovers", teams), {
      status: "unresolved", teamId: null, candidates: [],
    });
    const ambiguous = [
      ...teams,
      { id: "another-team", canonicalName: "Rovers FC", aliases: ["Rovers"], providerIds: {} },
    ];
    const result = resolveTeamIdentity("unknown-provider", undefined, "Rovers", ambiguous);
    assert.equal(result.status, "ambiguous");
    if (result.status === "ambiguous") assert.equal(result.candidates.length, 2);
  });
});
