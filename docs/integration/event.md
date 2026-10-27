# The event

An app tells the bridge it saw a user by publishing one [CloudEvent 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md), in structured JSON mode, on the `user-activity` topic exchange, with the event `type` as routing key. The app never calls Matomo or PostHog, and never waits for the bridge.

```json
{
  "specversion": "1.0",
  "id": "0192f0c2-7c1e-7000-8000-4b1f2a3c5d6e",
  "source": "twake://mail",
  "type": "com.twake.mail.user.active.v1",
  "time": "2026-10-24T10:30:00Z",
  "twakeactor": "alice@acme.example.com",
  "twakeactorid": "6f1c1b5e-0000-4000-8000-000000000001",
  "twakeorg": "acme123",
  "data": {
    "category": "foreground",
    "action": "share-by-link",
    "platform": "mobile",
    "ip": "203.0.113.7",
    "properties": { "button": "share", "view": "files", "count": 3 }
  }
}
```

Required: `specversion`, `id`, `source`, `type`, `time` and `twakeactor`.

- `type` names the app: `com.twake.<app>.user.active.v1`, where `<app>` is lowercase letters, digits and dashes.
- `time` is when the user acted, with a timezone. The bridge records this time, not the time it received the event.
- `twakeactor` is the user's address. It never leaves the bridge.
- `twakeactorid` is the user's LDAP `entryUUID`, when the app has it.
- `twakeorg` is the tenant: the organization's LDAP id, the one ldap-rest and the Twake Space events use, not its domain. B2C users share one mail domain, so a domain cannot tell tenants apart. Leave it out for a user with no organization.
- `data.category` is `foreground` when the user is looking at the app, `background` otherwise.
- `data.action` is what the user did, such as `share-by-link`. Keep the list short and stable per app: each value becomes a row in the reports.
- `data.platform` is `web`, `desktop` or `mobile`.
- `data.ip` is the user's IP address, for per user location in the reports. Take it from the user's request, never your server's own address. Behind a proxy, use the client address your own proxy adds, and check the proxy's trusted addresses: one that trusts `X-Forwarded-For` from anywhere passes on whatever the client wrote.
- `data.properties` says more about the action, such as which button or view, a duration or a count. It is a flat object of at most 50 keys. A key starts with a letter, then letters, digits and `_`, 64 characters at most. A value is a string, a finite number, a boolean or `null`. The keys `app`, `category`, `tenant` and `platform` belong to the bridge, and `$` keys to PostHog: The bridge keeps the event and drops only the keys it cannot use: an invalid or reserved key, a nested, array or non-finite value, and keys past the first 50. A string over 200 characters is cut. A `properties` that is not an object is dropped whole. The bridge logs the names of the dropped keys, never their values. Only PostHog records properties; Matomo records the action alone. Send ids, enums and counts, never content or personal data: see [Data](../security/data.md).

[Activity](../sources/activity.md) says what the bridge records from it, and [Failures](../architecture/failures.md) what happens to an event it cannot use.
