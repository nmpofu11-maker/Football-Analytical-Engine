import { canonicalFixtureKey, type FixtureStatus } from "./contracts";

export interface FixtureCandidate {
  provider: string;
  providerEventId: string;
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  seasonId: string;
  kickoffUtc: string;
  status: FixtureStatus;
  retrievedAt: string;
}

export interface ReconciledFixtureGroup {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  seasonId: string;
  kickoffUtc: string;
  status: FixtureStatus;
  providerEventIds: Record<string, string>;
  observations: FixtureCandidate[];
  conflicts: string[];
  eligibleForPrediction: boolean;
}

export interface ReconciliationResult {
  fixtures: ReconciledFixtureGroup[];
  rejected: Array<{ candidate: FixtureCandidate; reasons: string[] }>;
}

function validUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validateCandidate(candidate: FixtureCandidate): string[] {
  const errors: string[] = [];
  if (!candidate.provider.trim()) errors.push("provider is required");
  if (!candidate.providerEventId.trim()) errors.push("provider event id is required");
  if (!candidate.homeTeamId.trim() || !candidate.awayTeamId.trim()) errors.push("canonical home and away team ids are required");
  if (candidate.homeTeamId.trim().toLowerCase() === candidate.awayTeamId.trim().toLowerCase()) errors.push("home and away teams must differ");
  if (!candidate.competitionId.trim()) errors.push("canonical competition id is required");
  if (!candidate.seasonId.trim()) errors.push("season id is required");
  if (!validUtc(candidate.kickoffUtc)) errors.push("kickoff must be a valid UTC ISO timestamp ending in Z");
  if (!Number.isFinite(Date.parse(candidate.retrievedAt))) errors.push("retrievedAt must be a valid timestamp");
  return errors;
}

function sameFixture(a: FixtureCandidate, b: FixtureCandidate, toleranceMs: number): boolean {
  return a.homeTeamId.trim().toLowerCase() === b.homeTeamId.trim().toLowerCase() &&
    a.awayTeamId.trim().toLowerCase() === b.awayTeamId.trim().toLowerCase() &&
    a.competitionId.trim().toLowerCase() === b.competitionId.trim().toLowerCase() &&
    a.seasonId.trim().toLowerCase() === b.seasonId.trim().toLowerCase() &&
    Math.abs(Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc)) <= toleranceMs;
}

/**
 * Reconcile provider events only after provider-specific team IDs have been
 * resolved to canonical team IDs. A match within the tolerance is a candidate
 * link, not proof that the sources agree; conflicts block recommendation use.
 */
export function reconcileFixtureCandidates(
  candidates: FixtureCandidate[],
  toleranceMinutes = 15
): ReconciliationResult {
  const toleranceMs = Math.max(0, toleranceMinutes) * 60_000;
  const rejected: ReconciliationResult["rejected"] = [];
  const valid: FixtureCandidate[] = [];

  for (const candidate of candidates) {
    const reasons = validateCandidate(candidate);
    if (reasons.length) rejected.push({ candidate, reasons });
    else valid.push(candidate);
  }

  // Sorting makes grouping and the selected representative deterministic.
  valid.sort((a, b) =>
    Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc) ||
    a.competitionId.localeCompare(b.competitionId) ||
    a.homeTeamId.localeCompare(b.homeTeamId) ||
    a.awayTeamId.localeCompare(b.awayTeamId) ||
    a.provider.localeCompare(b.provider) ||
    a.providerEventId.localeCompare(b.providerEventId)
  );

  const groups: FixtureCandidate[][] = [];
  for (const candidate of valid) {
    const group = groups.find(existing => existing.some(item => sameFixture(item, candidate, toleranceMs)));
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }

  const eventIdGroups = new Map<string, Set<number>>();
  groups.forEach((group, groupIndex) => group.forEach(item => {
    const key = item.provider.trim().toLowerCase() + "|" + item.providerEventId.trim();
    const seen = eventIdGroups.get(key) ?? new Set<number>();
    seen.add(groupIndex);
    eventIdGroups.set(key, seen);
  }));

  const fixtures = groups.map((observations, groupIndex): ReconciledFixtureGroup => {
    const representative = observations[0]!;
    const conflicts: string[] = [];
    const kickoffs = new Set(observations.map(item => new Date(item.kickoffUtc).toISOString()));
    if (kickoffs.size > 1) conflicts.push("provider kickoff times disagree; manual or trusted-source resolution is required");

    for (const item of observations) {
      const key = item.provider.trim().toLowerCase() + "|" + item.providerEventId.trim();
      if ((eventIdGroups.get(key)?.size ?? 0) > 1) {
        conflicts.push("one provider event id maps to multiple fixture identities: " + key);
      }
    }

    const providerEventIds: Record<string, string> = {};
    for (const item of observations) {
      const providerKey = item.provider.trim().toLowerCase();
      if (providerEventIds[providerKey] && providerEventIds[providerKey] !== item.providerEventId) {
        conflicts.push("one provider supplied multiple event ids for the same candidate fixture: " + providerKey);
      } else {
        providerEventIds[providerKey] = item.providerEventId;
      }
    }

    const key = canonicalFixtureKey(representative);
    const fixtureId = key ? "fixture:" + key : "fixture:invalid";
    return {
      fixtureId,
      homeTeamId: representative.homeTeamId,
      awayTeamId: representative.awayTeamId,
      competitionId: representative.competitionId,
      seasonId: representative.seasonId,
      kickoffUtc: representative.kickoffUtc,
      status: observations.some(item => item.status === "finished") ? "finished" : representative.status,
      providerEventIds,
      observations,
      conflicts: [...new Set(conflicts)],
      eligibleForPrediction: conflicts.length === 0 && observations.length > 0,
    };
  });

  return { fixtures, rejected };
}
