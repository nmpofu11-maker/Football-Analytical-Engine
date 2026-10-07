export interface PresetPayload {
  name: string;
  source: "FBref" | "WhoScored" | "Flashscore";
  description: string;
  payload: string;
}

// Synthetic teaching/demo payloads only. They must never be treated as verified match history.
export const PRESET_PAYLOADS: PresetPayload[] = [
  { name:"Synthetic low-block example", source:"FBref", description:"Synthetic example for parser/model testing; not real match evidence.", payload:"[SYNTHETIC DEMO] Napoli 2-0 Roma; xG 1.92-0.45; possession 64%-36%; low block; no fatigue." },
  { name:"Synthetic derby example", source:"WhoScored", description:"Synthetic example for volatility/derby logic; not real match evidence.", payload:"[SYNTHETIC DEMO] Shanghai Port 3-2 Shanghai Shenhua; xG 2.41-2.12; possession 51%-49%; derby." },
  { name:"Synthetic fatigue example", source:"Flashscore", description:"Synthetic example for fatigue logic; not real match evidence.", payload:"[SYNTHETIC DEMO] Club Brugge 1-1 Charleroi; xG 1.12-1.08; possession 53%-47%; three-day recovery." }
];
