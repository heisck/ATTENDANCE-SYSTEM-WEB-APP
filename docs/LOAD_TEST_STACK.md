# Production-Like Load Test Stack

This stack gives you a closer production approximation for attendance burst testing than a single Windows `node` process.

## What It Starts

- `postgres` on host port `55432`
- `redis` on host port `56379`
- `app-1`, `app-2`, `app-3` as Linux Next.js production containers
- `nginx` on host port `8080` as the shared front door / load balancer
- `app-init` as a one-time schema+seed job

## Start The Stack

```bash
npm run stack:loadtest:up
```

Check health:

```bash
curl http://localhost:8080/nginx-health
```

## Prepare A Load-Test Session

This wrapper points Prisma and Redis at the containerized stack and uses the same load-test base URL:

```bash
npm run loadtest:stack:prepare -- 500
```

It also prewarms the attendance snapshots on `app-1`, `app-2`, and `app-3` so the first student burst is not paying the cold-cache cost on every node.

That writes:

- `load-tests/fixtures/attendance-users.json`
- `load-tests/fixtures/attendance-meta.json`
- `load-tests/fixtures/attendance-loadtest-command.txt`

## Run k6 Against Nginx

Use the generated command file or run manually with:

```bash
$meta = Get-Content 'load-tests\fixtures\attendance-meta.json' | ConvertFrom-Json
k6 run load-tests/attendance-burst.js `
  -e BASE_URL=http://localhost:8080 `
  -e USERS_FILE="$($meta.usersFile)" `
  -e SESSION_ID="$($meta.sessionId)" `
  -e QR_SECRET="$($meta.qrSecret)" `
  -e PHASE="$($meta.phase)" `
  -e ONE_SHOT=true `
  -e QR_VUS=500 `
  -e BLE_VUS=0 `
  -e READ_VUS=0
```

## Tear It Down

```bash
npm run stack:loadtest:down
```

## Notes

- This path keeps a shared Redis cache, unlike single-process local runs.
- The app containers do not each run schema setup on boot; only `app-init` does that once.
- The nginx upstream uses Docker DNS re-resolution, so container rebuilds do not leave the proxy pinned to stale app IPs.
- If you need more Node workers, duplicate the app service entries and add them to `docker/nginx/loadtest.conf`.
