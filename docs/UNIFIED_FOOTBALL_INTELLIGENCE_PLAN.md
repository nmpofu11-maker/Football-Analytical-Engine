# Unified Football Intelligence Platform — Architecture and Delivery Plan

**Status:** Proposal / audit baseline. No production prediction behaviour is changed by this document.

## Product decision

Use a hybrid strategy:
- Monitor fixtures broadly across the leagues and teams covered by authorised, configured data sources.
- Maintain deeper historical profiles for the original 80 Football Analytical Engine teams and teams the user explicitly adds.
- Generate betting recommendations selectively. A forecast is not automatically a bet recommendation.
- Never claim complete Hollywoodbets coverage unless coverage is actually measured and verified.

## Existing applications to consolidate

1. **Football-Analytical-Engine** — preserve the user's original 80-team scope and explicit prediction rules. Its current `simulateMatchup` is deterministic and evidence-gated, but still starts from fixed expected-goal priors (home 1.40, away 1.20) and applies coefficients/context adjustments. It is not yet a fully learned, validated team-strength model. Current tests check that probabilities sum to 100 and block UI estimates when either team has no verified historical sample.
2. **SoccerPredict-pro** — reuse audited provider adapters and fixture enrichment, prioritising SportAPI.ai and Sportmonks for analysis as requested. API-Football must remain a supporting provider rather than the primary prediction dependency. Keep provider identity, source health, competition compatibility and kickoff matching.
3. **BetMatrix** — reuse verified-data, provenance, odds/result ingestion, settlement and market-evaluation capabilities where tests and code review confirm they are suitable. Its README explicitly states that missing odds/results must remain unknown rather than fabricated.

Do not copy whole applications together. Extract and test reusable domain services behind stable interfaces.

## Non-negotiable integrity rules

- Canonical fixture identity includes provider IDs where available, home/away team IDs or carefully reviewed aliases, competition/season, and UTC kickoff. Never merge on team names alone.
- Store each provider observation with provider/source, retrieval time, source event ID, freshness, and validation status.
- Keep raw source payloads or a privacy-safe auditable representation separately from normalized records.
- Distinguish missing, stale, conflicting, invalid and verified fields. Do not silently replace unknowns with neutral-looking fake values.
- Store immutable pre-kickoff prediction snapshots, including model/rule version and data cut-off. Never rewrite predictions after the result.
- Only settle from verified final results; preserve corrections and provenance.
- Keep odds separate from team-performance features unless the model explicitly consumes timestamped odds.
- Separate outcome probabilities, model confidence/calibration, and betting value. They are different quantities.
- If data quality, minimum sample size or out-of-sample validation is insufficient, label the result exploratory or withhold a recommendation.
- AI explanations are advisory. Ollama cannot silently change production rules, edit settled outcomes or promote a model.
- Do not promise profits or describe a bet as safe or guaranteed.

## Proposed architecture

### A. Provider ingestion
Provider adapters for SportAPI.ai, Sportmonks, API-Football, TheRundown and any other authorised/configured source. Each adapter returns a common evidence envelope with source metadata and typed fields. Provider priority is field-specific and configurable; conflicts are retained for reconciliation instead of blindly overwriting data.

### B. Canonical football data store
Entities:
- Team and reviewed team aliases
- Competition and season
- Fixture and provider fixture mappings
- Time-stamped team/fixture statistics
- Final result evidence and result corrections
- Time-stamped odds/market observations
- Prediction snapshots and model versions
- Evaluation runs, error reports and model approvals
- User-selected priority teams and watchlists

Production persistence must be durable and verified. Do not use ephemeral Cloud Run local disk as a durable database. Before choosing SQLite/PostgreSQL/object storage, audit the current deployment and data migration constraints.

### C. Deterministic prediction service
Keep the user's rules in a versioned configuration and a tested deterministic engine. Candidate model features may include verified home/away scoring and conceding rates, opponent strength, recency-weighted form, competition baseline, rest interval and verified lineup/context data when available. Use a suitable score model (for example, Poisson or Dixon-Coles where justified) to derive score distributions and 1X2 probabilities. Do not include unavailable features. Do not equate a rounded expected-goals score with the most probable exact score.

### D. Selective recommendation layer
A forecast can exist without a bet recommendation. Recommendations require:
- Valid, fresh fixture identity and result/status checks
- Sufficient relevant historical sample
- Calibrated probabilities evaluated on unseen matches
- Timestamped odds for the exact market
- Value calculation with bookmaker margin considered
- A transparent uncertainty/risk status

If any required gate fails, show “insufficient evidence” or “no value found” rather than inventing a percentage.

### E. Ollama learning assistant
Run Ollama on the user's computer initially if hardware supports it. The backend should use a configurable local endpoint and model name, with timeouts, structured-output validation and a deterministic fallback. Never expose the Ollama API directly to the public internet. If a cloud-hosted app needs local Ollama, design a secure connection; localhost in Cloud Run is not the user's computer.

Ollama's responsibilities:
- Explain evidence and predictions from retrieved, approved records
- Summarize recurring forecast errors and likely data-quality issues
- Propose features/rule experiments with supporting evidence
- Help create readable post-match reviews

Ollama must not be the source of numeric probabilities, fabricate historical records, claim it has learned merely because it reviewed a match, or automatically deploy model changes.

### F. Statistical learning and evaluation
Use a separate, reproducible training/evaluation pipeline:
1. Split by time: train on older matches, validate on later matches, and reserve a final holdout period.
2. Prevent leakage: each prediction can use only information available before kickoff.
3. Compare a simple baseline with each candidate.
4. Evaluate log loss, Brier score, calibration/reliability, coverage, and market-specific performance. Track accuracy but do not use accuracy alone.
5. Segment by competition, market, team sample size and data quality.
6. Promote candidates only when predefined holdout criteria are met; preserve rollback and model lineage.
7. Re-run after enough new verified results accumulate, not after every isolated loss.

## Dashboard

- Fixture monitor: broad coverage, provider coverage and source freshness
- Priority teams: original 80 plus user-added teams, with profile completeness
- Match analysis: source-by-source evidence and missing fields
- Predictions: probabilities, expected goals, model version, evidence gate and explanation
- Markets: verified odds, implied probabilities, estimated value and uncertainty
- Track record: immutable predictions joined to verified results
- Learning lab: backtests, calibration charts, error clusters and candidate-vs-current comparison
- Data health: provider failures, stale feeds, conflicting fixtures and persistence status
- Settings: team list, provider priority, thresholds and rule versions

## Delivery sequence

### Phase 0 — Audit and baseline (current)
- Verify each repository's default branch, active PRs, tests, model rules, provider adapters, storage and deployment assumptions.
- Identify duplicate implementations and preserve original rule behaviour in tests.
- Export a data inventory before any migration.
- Produce a field-by-field provider capability matrix. Key presence is not proof that a provider call succeeds.

### Phase 1 — Canonical contracts and evidence store
- Define shared TypeScript contracts for Team, Fixture, ProviderObservation, MatchResult, OddsSnapshot, PredictionSnapshot and ModelVersion.
- Add stable IDs, provenance, UTC timestamps, freshness and conflict status.
- Add contract tests and duplicate/mismatch tests before integrating adapters.

### Phase 2 — Prediction baseline
- Port the chosen deterministic rule set behind the shared interface.
- Ensure the engine cannot produce misleading equal percentages for unrelated fixtures by default or substitute missing data with placeholders.
- Add probability distribution, calibration and temporal backtest tests.

### Phase 3 — Durable persistence and provider reconciliation
- Select a durable store based on the actual deployment environment.
- Reconcile fixtures and results from SportAPI.ai and Sportmonks first for the SoccerPredict analysis path, retaining other providers as supporting sources.
- Verify live responses and provenance; test restart persistence before calling the system production-ready.

### Phase 4 — Shadow evaluation and paper predictions
- Record forecasts without placing bets.
- Compare predictions to verified outcomes on a rolling, unseen period.
- Require explicit acceptance criteria before recommendations are enabled.

### Phase 5 — Local Ollama and controlled learning
- Add an opt-in local Ollama endpoint, model health check and structured response validation.
- Build post-match error reports and experiment proposals.
- Automate candidate training/evaluation, but require objective gates and model-version approval before promotion.

## Initial acceptance criteria

- No fabricated fixtures, odds, results, statistics, sample sizes or probabilities.
- No cross-fixture reuse of statistics without verified team/fixture linkage.
- Every displayed prediction has a timestamp, fixture identity, model/rule version and evidence status.
- Historical evaluation uses only information available before kickoff.
- Probabilities are valid distributions; calibration is measured separately.
- A missing provider or failed request produces explicit degraded status.
- Persistence survives a restart in the intended deployment environment.
- Local Ollama failure does not break deterministic prediction or data ingestion.
- AI-generated changes cannot override the user's rules without an explicit reviewed change.
- Bet recommendations remain disabled until their evidence and validation gates pass.

## Known audit observations

- Football-Analytical-Engine `package.json` provides `npm run check` (lint, integrity tests, build). Its server uses JSON files in `DATA_DIR` and blocks write operations when durable storage is not verified.
- Football-Analytical-Engine's existing model uses fixed home/away expected-goal priors and learned-coefficient adjustments; the current evidence gate blocks UI estimates when verified historical samples are absent, but sample existence alone is not proof of calibration.
- SoccerPredict-pro has a separate deterministic rules engine and provider-enrichment layer; these need a rules/feature audit before consolidation.
- BetMatrix has a verified-data layer and tests/build scripts, but its documentation says successful build/health does not prove live sports data is available.
- These are source-code observations only. No live API calls, deployed revision, production database or local Ollama installation were verified by this document.
