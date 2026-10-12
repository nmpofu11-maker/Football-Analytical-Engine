export interface CanonicalTeamIdentity {
  id: string;
  canonicalName: string;
  aliases: string[];
  providerIds?: Record<string, string>;
}

export type TeamIdentityResolution =
  | { status: "resolved"; teamId: string; method: "provider-id" | "exact-alias" }
  | { status: "unresolved"; teamId: null; candidates: [] }
  | { status: "ambiguous"; teamId: null; candidates: string[] }
  | { status: "conflict"; teamId: null; candidates: string[]; reason: string };

/**
 * Conservative name normalization. It removes punctuation, diacritics and
 * common club prefixes/suffixes but deliberately preserves words such as
 * "City", "United" and "Athletic".
 */
export function normalizeTeamName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|cf|sc|afc|ac|ssc|cd|fk|sk|bk|if|ff)\b/gi, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve provider team identity only through an explicit provider-ID mapping
 * or an exact normalized canonical-name/alias match. No fuzzy guessing.
 */
export function resolveTeamIdentity(
  provider: string,
  providerTeamId: string | number | undefined,
  observedName: string,
  registry: CanonicalTeamIdentity[]
): TeamIdentityResolution {
  const normalizedObserved = normalizeTeamName(observedName);
  const idMatches = providerTeamId === undefined || String(providerTeamId).trim() === ""
    ? []
    : registry.filter(team => team.providerIds?.[provider] === String(providerTeamId).trim());
  const nameMatches = normalizedObserved
    ? registry.filter(team => [team.canonicalName, ...team.aliases]
        .some(alias => normalizeTeamName(alias) === normalizedObserved))
    : [];
  const idIds = [...new Set(idMatches.map(team => team.id))];
  const nameIds = [...new Set(nameMatches.map(team => team.id))];

  if (idIds.length > 1) {
    return { status: "ambiguous", teamId: null, candidates: idIds };
  }
  if (idIds.length === 1 && nameIds.length > 0 && !nameIds.includes(idIds[0]!)) {
    return {
      status: "conflict",
      teamId: null,
      candidates: [...new Set([...idIds, ...nameIds])],
      reason: "provider team id and exact team-name mapping disagree",
    };
  }
  if (idIds.length === 1) return { status: "resolved", teamId: idIds[0]!, method: "provider-id" };
  if (nameIds.length === 1) return { status: "resolved", teamId: nameIds[0]!, method: "exact-alias" };
  if (nameIds.length > 1) return { status: "ambiguous", teamId: null, candidates: nameIds };
  return { status: "unresolved", teamId: null, candidates: [] };
}
