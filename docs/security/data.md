# Data

For each hit, the backend receives the app, the time, the category, the action, the tenant, the platform, the pseudonym, and the user's IP address when the app sent one. The user's address never leaves the bridge.

- `data.properties` reaches PostHog as the app sent it, and the bridge does not look at it. Apps send ids, enums and counts only, never content, names or addresses. Matomo does not get them.
- A pseudonym is still personal data: anyone holding `PSEUDONYM_PEPPER` can check whether a known address is a given pseudonym.
- An IP address is personal data. Matomo applies its IP anonymization setting to it; check your PostHog project's IP settings before apps start sending it.
- [Erasure](../sources/erasure.md) deletes a user's analytics when their account is deleted. It is off by default, and turning it on is a legal decision.

## Logs

The logs carry a message's routing key, message id and the error, not its body. The exception is a message that is not JSON: the RabbitMQ client logs its first 100 characters at error level, and they also go to Sentry when it is on.
