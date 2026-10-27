# Matomo

## Setting it up

1. Create one site per app, plus a `billing` site when [paying users](../sources/paying-users.md) are on. List them in `MATOMO_SITES`, such as `{"mail":3,"chat":2,"billing":5}`.
2. On every site, create two visit-scoped custom dimensions, `tenant` and `platform`, and give their ids in `MATOMO_DIMENSIONS`, such as `{"tenant":1,"platform":2}`. Matomo numbers dimensions per site and the bridge takes one id for all of them, so create them in the same order everywhere. Without them, reports cannot split by organization or by client.
3. Create a dedicated user with `write` access to those sites, or `admin` when [erasure](../sources/erasure.md) is on, and give its token in `MATOMO_TOKEN`.
4. Run `core:archive` from cron and turn off browser-triggered archiving, as Matomo recommends for production. Otherwise reports for past days only refresh when someone opens them.

`scripts/matomo-setup.sh` does the first two on a local Matomo, and uses the super user's token, which is fine on a laptop only.

## What it records

Each hit is an event on the app's site, under the pseudonym as user id, at the hit's time.

- Event category: the hit's category, such as `foreground`.
- Event action: the hit's action, such as `share-by-link` or `task.assigned`.
- The `tenant` and `platform` dimensions, when configured.
- The user's IP address, when the app sent one. Matomo applies its IP anonymization setting to it.

Matomo records the action alone: `data.properties` is for PostHog.

A hit for an app with no site is refused and dead lettered.

## Reading the reports

- Visitors > User IDs: the pseudonymous users of a site.
- Behaviour > Events > Event Actions: how often each action happened.
- Visitors > tenant and Visitors > platform: the same reports per organization and per client.
- The `billing` site: subscription changes over time. Matomo has no per user property, so it cannot give a current count of paying users.
