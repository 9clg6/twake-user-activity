# Activity

Apps publish a CloudEvent `com.twake.<app>.user.active.v1` on `user-activity` when they see a user. The bridge binds `com.twake.*.user.active.v1`. This source is always on. [The event](../integration/event.md) describes what apps send.

The hit takes:

- the app from the type,
- the pseudonym of `twakeactor`,
- the event's `time`, not the time the bridge received it,
- the category from `data.category`: `foreground`, `background`, or `unclassified` when absent,
- the action from `data.action`, `activity` when absent,
- the platform, IP address and properties from `data`,
- the tenant from `twakeorg`.

An event that is not valid is logged and dropped. An app cannot publish as `billing`: the name is reserved for [paying users](paying-users.md).
