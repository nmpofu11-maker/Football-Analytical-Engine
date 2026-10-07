import { TeamIntelligenceMatrix } from "../types";

export const LOCKED_80_TEAMS = [
  "Ahlafors IF","Almaz Antey Youth","Atletico Nacional Medellin (W)","Azam","Baerum U19","BE1 NFA","Beijing Guoan","Benfica U19","BK Forward","Bolivar",
  "Boston River Reserve","Club Brugge","Dinamo Zagreb","Dnepr Mogilev","Ekenas IF Fotbolll","FC Dinamo City","FC Flora Tallinn","FC Gomel","FC Iberia 1999 Tbilisi","FC Nantes",
  "FC Noah","FC Nomme United","FC Pyunik","FC Ulaanbaatar","Fotbal Club FCSB","Fram Reykjavik","France U16","Gnistan Helsinki","Haugesund B","Hunters FC",
  "Inter Milan Women","Japan U16","Johor Darul Ta'zim FC","KF Laci","Lillestrom B","Linfield Women","Lorenskog U19","Madura United","MC Oran","FK Mladost DG",
  "Mohun Bagan Super Giant","Napoli","NEC Nijmegen","MSK Zilina","Nacional De Football Women","Pattani","Penarol Reserve","Peru Women","Poland Women","PVF-CAND FC",
  "Qingdao Team","Qviding FIF","RC Sporting Charleroi","Real Cartagena","Riga FC","Rigas Futbola Skola","Rijeka","Rosenborg BK Women","FK Rostov Youth","Saldus SS/Leevon",
  "Shanghai Port","Shanghai Shenhua","Shelbourne Women","Sligo Rovers Women","Slovan Ljubljana","Smedby AIS","St Johnstone F.C.","St. Patrick's Athletic","Stenungsunds IF","Stenungsunds IF",
  "Tabor Sezana","Tabora United FC","Taftea IK","Truong Tuoi Dong Nai","Tvaakers IF","Uruguay","Us Pergolettese","Viimsi JK","Vorup FB","Wolfsberger AC Amateure","ZNK Agram (w)"
];

// These are league classifications, not performance assumptions.
const FAST_PACED_TEAMS = new Set([
  "Ahlafors IF","Beijing Guoan","BK Forward","Haugesund B","Japan U16","Lillestrom B","Qingdao Team","Qviding FIF",
  "Shanghai Port","Shanghai Shenhua","Smedby AIS","Stenungsunds IF","Taftea IK","Tvaakers IF"
]);

export function isFastPacedLeagueTeam(teamName: string): boolean {
  return FAST_PACED_TEAMS.has(teamName);
}

// Priors are explicitly marked as unlearned until verified historical observations are ingested.
export function generateDefaultMatrices(): Record<string, TeamIntelligenceMatrix> {
  const matrices: Record<string, TeamIntelligenceMatrix> = {};
  for (const team of LOCKED_80_TEAMS) {
    matrices[team] = {
      sample_size_matches: 0,
      learned_coefficients: {
        home_advantage_multiplier: 1,
        form_momentum_weight: 1,
        volatility_index: 1,
        fatigue_penalty_modifier: 1
      }
    };
  }
  return matrices;
}
