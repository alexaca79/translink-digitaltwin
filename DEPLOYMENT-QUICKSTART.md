---
title: TransLink Digital Twin Deployment Quickstart
description: Short path to deploy the TransLink Fabric, Rayfin, and ACA workload
ms.date: 2026-08-20
ms.topic: quickstart
---

## Before you start

You need:

* A registered TransLink Open API key
* An existing supported Fabric capacity
* Contributor or higher access to the target Fabric workspace
* Fabric Apps enabled by the tenant administrator
* Azure CLI, the Container Apps extension, Node.js 22, npm, and Git
* An isolated `AZURE_CONFIG_DIR` that points to the intended tenant profile

Never place the TransLink API key in Git, browser environment variables, build
arguments, or command output.

## 1. Install and validate

```powershell
npm ci
npm run gtfs:sync
npm test
npm run lint
npm run build
npm run typecheck:tools
npm run fabric:plan
```

## 2. Create the Fabric workspace

Create a new workspace named `TransLink Digital Twin` and assign it to the
existing Fabric capacity. Record the workspace ID.

## 3. Deploy Fabric items

```powershell
npx tsx scripts/deployFabric.ts `
  --tenant-id <tenant-id> `
  --subscription <subscription-id-or-name> `
  --workspace-id <workspace-id>
```

This creates or reuses:

* `TransLinkEventhouse`
* `TransLinkOperations`
* `TransLinkTelemetry`
* `TransLinkSchedule`
* Static schedule notebooks and the optional native-ingest prototype

Non-secret deployment IDs are written to `.fabric/deployment.local.json`.

## 4. Create the ACA publisher boundary

Create a new resource group such as `rg-translink-digital-twin` in `westus2`.
Inside it, create:

* A Basic Azure Container Registry
* A Consumption Container Apps environment
* One Container App named `ca-translink-publisher`

Build [Dockerfile.publisher](Dockerfile.publisher), keep exactly one warm
replica, expose port `7071` over HTTPS, and store these values as ACA secrets or
settings:

* `TRANSLINK_API_KEY`
* Fabric Eventstream broker, topic, username, and password
* `FABRIC_KQL_QUERY_URI`
* `FABRIC_KQL_DATABASE=TransLinkOperations`

Grant the publisher identity `AcrPull` on the registry and KQL viewer access on
`TransLinkOperations`.

The image bundles the static schedule produced by `npm run gtfs:sync`. Rebuild
and deploy a new immutable image before the `feed_end_date` in
`data/gtfs-static/feed_info.txt`.

## 5. Deploy Rayfin

Set `VITE_TELEMETRY_API_URL` to the ACA HTTPS origin before building the Fabric
app:

```powershell
$env:VITE_TELEMETRY_API_URL = 'https://<publisher-host>'
npx rayfin login --tenant <tenant-id>
npx rayfin up --workspace-id <workspace-id>
npx rayfin up status
```

Restrict the ACA publisher CORS origin to the deployed Rayfin hosting URL, then
create a new ACA revision.

## 6. Validate

Confirm:

* `/api/health` returns `200` and reports a recent successful poll
* `/api/health` reports `scheduleCurrent: true`
* `/api/ready` returns `200`
* `/api/live` returns current TransLink vehicles and alerts
* Eventhouse receives vehicle, trip-update, and alert rows
* The Rayfin app opens through the Fabric portal and completes embedded SSO
* The map centers on Metro Vancouver and offers Rail, Ferry, and Bus filters
* The required TransLink attribution legend is visible

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed commands, rollback, and recovery.
