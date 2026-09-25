export interface PresetPayload {
  name: string;
  source: "FBref" | "WhoScored" | "Flashscore";
  description: string;
  payload: string;
}

export const PRESET_PAYLOADS: PresetPayload[] = [
  {
    name: "Napoli Low-Block Breakthrough",
    source: "FBref",
    description: "SSC Napoli breaks Roma's compact low-block defense with extreme shot accuracy inside the box.",
    payload: `=========================================
[FBREF STATS] SERIE A - MATCHWEEK 12
=========================================
Match: SSC Napoli 2-0 AS Roma
xG conversion: Napoli (1.92) - Roma (0.45)
Possession dominance: 64% - 36%
Pass Completion: Napoli (89%) - Roma (72%)

PITCH EVENTS & TACTICAL ANALYSIS:
- Roma deployed a 5-4-1 compact defensive low-block with zero high pressing.
- Napoli dominated the final third with 24 positional spreads, achieving 8 shot attempts inside the box.
- Shot accuracy gap was positive (+12% above standard league low-block average).
- Expected goals converted: Napoli broke the deadlock in the 71st minute from an expected 0.35 xG opportunity.
- No continental cup fatigue was logged for either team.`
  },
  {
    name: "Shanghai Derby (Fast-Paced geographic league)",
    source: "WhoScored",
    description: "High-intensity geographic derby between Shanghai Port and Shanghai Shenhua. Local derby bias and geographic dampening applies.",
    payload: `=========================================
[WHOSCORED MATCH REPORT] CHINESE SUPER LEAGUE
=========================================
Fixture: Shanghai Port 3-2 Shanghai Shenhua
Location: Pudong Football Stadium (Local Derby)
Expected Goals: Shanghai Port (2.41) - Shanghai Shenhua (2.12)
Possession Graph: 51% - 49%
Shots on Target: 9 - 8
Sprints / High Intensity Runs: 142 - 138 (Extremely fast-paced transitions)

TACTICAL SPREADS:
- High geographic volatility recorded. Game experienced open, vertical transitions characteristic of CSL.
- Severe defensive line separation from both sides (+18m spread).
- Possession dominance swung rapidly.
- Derby tension was high, resulting in 7 yellow cards and 1 red card.`
  },
  {
    name: "Club Brugge Fatigue & Rotation Test",
    source: "Flashscore",
    description: "Club Brugge plays an intense domestic match only 3 days after a grueling Champions League away fixture.",
    payload: `=========================================
[FLASHSCORE LIVE] PRO LEAGUE BELGIUM
=========================================
Match: Club Brugge 1-1 RC Sporting Charleroi
xG conversion: Club Brugge (1.12) - Charleroi (1.08)
Possession: 53% - 47%
Physical distance covered: Club Brugge (104km - -8% below normal average)

ROTATION & FATIGUE STATUS:
- Club Brugge played Atletico Madrid away in the Champions League exactly 3 days ago.
- Manager implemented 4 starting line-up rotations to cope with fatigue.
- Defensive positional spreads were loose due to recovery delay.
- Fatigue penalty modifier of 0.92 is highly relevant.`
  }
];
