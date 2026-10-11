# Personal OneDrive storage integration

## Current status and safety boundary

The Microsoft Graph client in `src/services/oneDriveStorage.ts` provides delegated personal-account OAuth, file read/write helpers, ETag checks, and a read-back connectivity probe. The API's existing JSON data stores are **not yet migrated** to this backend. Do not interpret `/api/onedrive/probe` success as proof that historical results, predictions, fixtures, matrices, or settings are stored in OneDrive. Normal mutating API routes remain blocked unless the existing durable-storage guard passes.

## Microsoft app registration

1. Open the Microsoft Entra admin center and create an App registration.
2. Choose the supported account type that includes **Personal Microsoft accounts**. A single-tenant work/school-only registration will not work for this design.
3. Add a **Web** redirect URI that exactly matches `ONEDRIVE_REDIRECT_URI`, for example `https://YOUR_PUBLIC_APP_HOST/api/onedrive/auth/callback`. Use the public URL of the deployed revision; a localhost URI will not work for Cloud Run.
4. Create a client secret. Store its value only in your deployment's secret manager as `ONEDRIVE_CLIENT_SECRET`.
5. Request delegated Microsoft Graph permissions `Files.ReadWrite`, `User.Read`, and `offline_access`. Use the minimum permission set; do not grant application-wide drive access.
6. Configure these environment/secret names on the same deployed revision:
   - `ONEDRIVE_CLIENT_ID` (app registration ID)
   - `ONEDRIVE_CLIENT_SECRET` (secret value)
   - `ONEDRIVE_REDIRECT_URI` (exact registered callback URL)
   - `ADMIN_API_KEY` (existing administrative API key)
7. Deploy this code before starting consent. During OAuth bootstrap, configure a single service instance so the short-lived state value is handled by the same process that receives the callback.

## Authorize the personal account

1. Send an authenticated `POST /api/onedrive/auth/start` with `x-admin-api-key: <ADMIN_API_KEY>`. It returns an `authorizationUrl`; open that URL in your browser.
2. Sign in with the personal Microsoft account that owns the OneDrive you want to use and consent to the requested delegated permissions.
3. Microsoft redirects to `/api/onedrive/auth/callback`. The callback validates one-time OAuth state and returns a refresh token once. Do not paste it into chat, commit it to GitHub, or share a screenshot.
4. Immediately store the returned `refreshToken` as the secret `ONEDRIVE_REFRESH_TOKEN` in your deployment secret manager, then redeploy. The token is not persisted by the callback handler.
5. Microsoft may return a rotated refresh token when one is used. This implementation keeps the latest token in memory for the current process; keep the bootstrap secret protected and be prepared to re-authorize/replace it if Microsoft revokes or expires it. Never log OAuth tokens.

## Verify Graph access

After redeploy, send authenticated `POST /api/onedrive/probe` with `x-admin-api-key`. The probe accesses `/me/drive`, ensures a `FootballAnalyticalEngine` folder exists, writes `storage-connectivity-probe.json`, and reads it back. A successful result proves only that Graph read/write works for the signed-in account. It does not prove that app records have been migrated.

Use `GET /api/diagnostics/onedrive` for sanitized status. Diagnostics must never expose access tokens, refresh tokens, client secrets, or authorization codes.

## Data migration requirements (next implementation stage)

Migrate every active data store to the OneDrive provider before declaring OneDrive the source of truth. At minimum inventory and migrate:
- `db_results.json` (verified historical evidence)
- `db_matrices.json`
- `db_fixtures.json`
- `db_predictions.json`
- `db_coefficient_history.json`
- `db_target_teams.json`
- `fixtures-manifest.json`
- results API configuration/cache files

The migration must be asynchronous end-to-end: reads must load remote state, and mutating routes must await a verified remote write before returning success. Include ETag/conditional updates, conflict handling, schema validation, read-back checks, and a one-time import path for existing local data. Do not mirror writes in the background and report success before OneDrive confirms them. Keep writes disabled until the migration is complete and a restart/read-back test passes.

For a multi-instance deployment, add a durable distributed lock or move mutable records to a transactional database; OneDrive files plus ETags are not a general-purpose transactional database. Keep prediction calibration blocked until verified historical and out-of-sample evidence is available.

## References

- Microsoft identity platform authorization-code flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Microsoft Graph upload/replace file content and delegated personal-account permission: https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
- Microsoft Graph conditional requests and upload-session ETag behavior: https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession
