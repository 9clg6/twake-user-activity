# PostHog

## Setting it up

- `POSTHOG_HOST`: the ingestion host, such as `https://eu.i.posthog.com`.
- `POSTHOG_API_KEY`: the project API key, the public one browsers use.
- With [erasure](../sources/erasure.md) on, `POSTHOG_PROJECT_URL` (the project's address as the browser shows it) and `POSTHOG_PERSONAL_API_KEY` (a personal API key with the `person:write` scope) too.

## What it records

Each hit is an event named after the hit's action, under the pseudonym as distinct id, at the hit's time, with these properties:

- `app` and `category`.
- `tenant` and `platform`, when known.
- The app's `data.properties`, each under its own key. The keys above win over them.
- `$groups.organization`, the tenant, so with group analytics an insight can count active organizations and split any report per organization.
- `$ip`, the user's IP address, when the app sent one. Without it the bridge turns off GeoIP, so PostHog does not place the user at the bridge's own location.
- `$set.paying`, on a subscription change, a person property for counting paying users.

PostHog accepts every event of a valid batch, so it never refuses a single hit.

## Reading the reports

- Active users: a trends insight on any event, counting unique users, broken down by `app`.
- Desktop and mobile: the same insight broken down by `platform`.
- Feature use: a trends insight per event name, such as `task.assigned`.
- Paying users: unique users filtered on the person property `paying`.
- Per organization: any of these aggregated by the `organization` group, which needs group analytics.
