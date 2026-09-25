import { TeamIntelligenceMatrix } from "../types";

export const LOCKED_80_TEAMS = [
  "Ahlafors IF",
  "Almaz Antey Youth",
  "Atletico Nacional Medellin (W)",
  "Azam",
  "Baerum U19",
  "BE1 NFA",
  "Beijing Guoan",
  "Benfica U19",
  "BK Forward",
  "Bolivar",
  "Boston River Reserve",
  "Club Brugge",
  "Dinamo Zagreb",
  "Dnepr Mogilev",
  "Ekenas IF Fotbolll",
  "FC Dinamo City",
  "FC Flora Tallinn",
  "FC Gomel",
  "FC Iberia 1999 Tbilisi",
  "FC Nantes",
  "FC Noah",
  "FC Nomme United",
  "FC Pyunik",
  "FC Ulaanbaatar",
  "Fotbal Club FCSB",
  "Fram Reykjavik",
  "France U16",
  "Gnistan Helsinki",
  "Haugesund B",
  "Hunters FC",
  "Inter Milan Women",
  "Japan U16",
  "Johor Darul Ta'zim FC",
  "KF Laci",
  "Lillestrom B",
  "Linfield Women",
  "Lorenskog U19",
  "Madura United",
  "MC Oran",
  "FK Mladost DG",
  "Mohun Bagan Super Giant",
  "Napoli",
  "NEC Nijmegen",
  "MSK Zilina",
  "Nacional De Football Women",
  "Pattani",
  "Penarol Reserve",
  "Peru Women",
  "Poland Women",
  "PVF-CAND FC",
  "Qingdao Team",
  "Qviding FIF",
  "RC Sporting Charleroi",
  "Real Cartagena",
  "Riga FC",
  "Rigas Futbola Skola",
  "Rijeka",
  "Rosenborg BK Women",
  "FK Rostov Youth",
  "Saldus SS/Leevon",
  "Shanghai Port",
  "Shanghai Shenhua",
  "Shelbourne Women",
  "Sligo Rovers Women",
  "Slovan Ljubljana",
  "Smedby AIS",
  "St Johnstone F.C.",
  "St. Patrick's Athletic",
  "Stenungsunds IF",
  "Tabor Sezana",
  "Tabora United FC",
  "Taftea IK",
  "Truong Tuoi Dong Nai",
  "Tvaakers IF",
  "Uruguay",
  "Us Pergolettese",
  "Viimsi JK",
  "Vorup FB",
  "Wolfsberger AC Amateure",
  "ZNK Agram (w)"
];

// Helper to check if a team is in a fast-paced geographic league requiring volatility dampening
export function isFastPacedLeagueTeam(teamName: string): boolean {
  const fastPacedTeams = [
    "Ahlafors IF", // Sweden
    "Beijing Guoan", // China
    "BK Forward", // Sweden
    "Haugesund B", // Norway
    "Japan U16", // Japan
    "Lillestrom B", // Norway
    "Qingdao Team", // China
    "Qviding FIF", // Sweden
    "Shanghai Port", // China
    "Shanghai Shenhua", // China
    "Smedby AIS", // Sweden
    "Stenungsunds IF", // Sweden
    "Taftea IK", // Sweden
    "Tvaakers IF" // Sweden
  ];
  return fastPacedTeams.includes(teamName);
}

// Generate default matrix for each of the locked teams
export function generateDefaultMatrices(): Record<string, TeamIntelligenceMatrix> {
  const matrices: Record<string, TeamIntelligenceMatrix> = {};
  
  LOCKED_80_TEAMS.forEach(team => {
    const isFast = isFastPacedLeagueTeam(team);
    matrices[team] = {
      sample_size_matches: 15,
      learned_coefficients: {
        home_advantage_multiplier: 1.12,
        form_momentum_weight: 0.95,
        volatility_index: isFast ? 0.82 : 1.00, // lower index (closer to 0.8) indicates applied volatility dampener for fast-paced leagues
        fatigue_penalty_modifier: 0.92
      }
    };
  });
  
  return matrices;
}
