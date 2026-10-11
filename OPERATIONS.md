# Deployment and persistence notes

## Managed target teams

- The original 80 teams are always retained.
- New teams are added explicitly through **Verified Results & History → Manage target teams**.
- Adding a team creates a zero-sample matrix. It does not create verified history or unlock predictions.
- The list and matrices are stored in the application's data directory.

## Persistent storage

The server accepts `DATA_DIR` as an environment variable. Both `server.ts` and `server-db.ts` use the same resolved path.

For local development, the default is `./data`. On a container/serverless host, that directory may be ephemeral. Set `DATA_DIR` to a writable directory backed by a persistent mounted volume, or configure an external durable database before relying on data surviving restarts or multiple instances. Merely setting `DATA_DIR` to another local path does not make it persistent.

The read-only `GET /api/diagnostics/evidence` endpoint reports whether `DATA_DIR` is configured and reminds operators to verify the path is backed by durable storage. It does not verify the host's volume semantics.

## Administrative writes

All mutating `/api/*` endpoints, including `POST /api/teams`, require `ADMIN_API_KEY` and the `x-admin-api-key` request header, except the separately guarded results webhook route. Keep the key in the hosting secret store; do not commit it or expose it in client-side source. The UI prompts for the key and retains it only in session storage.

## Evidence and calibration

- Provider key presence is not proof that provider requests are succeeding.
- Historical backfill records are not automatically model calibration.
- A team added to the target list begins with zero samples.
- Keep the evidence gate enabled until a documented out-of-sample evaluation validates the model.
