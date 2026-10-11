# Cloud Run persistence and provider setup

## Durable storage

This app writes fixture and result files under DATA_DIR. A writable local container directory may still be ephemeral after a restart or revision change.

For a Cloud Run service you control:
1. Select a Cloud Storage bucket in the same Google Cloud project.
2. Open the service and choose Edit and deploy new revision.
3. Add a Cloud Storage volume using that bucket and mount it at /mnt/persistent-data.
4. Grant the service's runtime identity the required object access on that bucket.
5. Set DATA_DIR=/mnt/persistent-data and deploy.
6. Check /api/diagnostics/evidence. Confirm storage.writable and storage.persistenceVerified are true.
7. Record historicalEvidence.storedResultRecords, restart or deploy a new revision, and check the count and known results again.

A managed AI Studio preview may not expose volume configuration. If so, use a Cloud Run service you control for durable operation. A custom DATA_DIR by itself does not prove persistence.

## Provider environment settings

Configure these names on the same deployed revision:
- SPORTAPI_AI_KEY
- THERUNDOWN_KEY
- API_FOOTBALL_KEY
- RESULTS_API_URL (optional; must point to an official API-Football/API-Sports endpoint for historical backfill)

Keep secret values in the cloud secret store; never commit them or return them in diagnostics.

## Live verification

- GET /api/diagnostics/evidence: verify provider configuration, readable history, and storage persistence.
- GET /api/real-fixtures?date=YYYY-MM-DD: check verifiedOnly, source, and real team/competition names.
- Upcoming fixtures must not show stale scores. Finished results must have a trusted final status and valid score.
- TheRundown responses are cached for five minutes and rate-limit responses trigger bounded backoff.
- Historical imports alone do not calibrate the prediction model; prediction readiness requires verified out-of-sample calibration.
