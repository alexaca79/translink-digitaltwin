---
title: Security Policy
description: Security reporting and data-handling boundaries for the TransLink Digital Twin
ms.date: 2026-08-20
ms.topic: reference
---

Microsoft takes the security of our software products and services seriously,
which includes all source code repositories in our GitHub organizations.

## Reporting a vulnerability

Do not report security vulnerabilities through public GitHub issues.

For reporting instructions, contact information, and disclosure policy, review
the latest guidance for Microsoft repositories at
[https://aka.ms/SECURITY.md](https://aka.ms/SECURITY.md).

## Scope notes for this repository

This project reads TransLink GTFS data under TransLink's developer terms. It
stores no personal data, fare data, or employee data.

The publisher requires a TransLink Open API key for realtime feeds. Keep that
key in the publisher process environment or an ACA secret. Never expose it
through a `VITE_*` variable, browser bundle, log message, health response, or
committed file.

The TransLink publisher exposes read-only HTTP endpoints. Before running it on a
public address, understand these boundaries:

* The endpoints are unauthenticated. `PUBLISHER_ALLOWED_ORIGIN` restricts
  browser origins through CORS, which is not an authorization control.
* `PUBLISHER_RATE_LIMIT_PER_MINUTE` throttles per caller and defaults to 60.
  It limits casual abuse and does not replace a gateway.
* `/api/health` reports whether a dependency is failing but withholds the
  error text. Set `PUBLISHER_EXPOSE_ERROR_DETAIL=true` only on private
  deployments.
* `/api/route-performance` accepts an allow-listed lookback only, so caller
  input never reaches the query text.

Add authentication, a gateway, and monitoring before exposing internal
TransLink, employee, incident, or passenger data through this API.
