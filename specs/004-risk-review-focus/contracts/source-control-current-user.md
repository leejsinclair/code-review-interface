# Contract: `SourceControlProvider.currentUser()`

Added to `src/contracts/source-control.ts` (read contract, VIII.3):

```ts
export type CurrentUser = { handle: string; displayName: string };
/** Read-only. Rejects with AdapterError `unauthorized` or `unavailable`. One GET, no write. */
currentUser(): Promise<CurrentUser>;
```

| Adapter | Request | `handle` | `displayName` |
|---|---|---|---|
| GitHub | `GET /user` | `login` | `name`, else `login` |
| GitLab | `GET /user` | `username` | `name`, else `username` |
| Bitbucket Cloud | `GET /user` | `account_id` | `display_name` |

- Each adapter's `verifySignIn` and `approvedByMe` use `currentUser()` instead of their own `/user` call. Their
  observable behaviour (`account` value, approval results) does not change; existing tests keep passing.
- Contract-suite case (`test/contract/source-control.suite.ts`, run by every adapter, no platform branching):
  1. `currentUser` returns the expected `{ handle, displayName }` from the target's data with one `GET`;
  2. a refused credential rejects with `AdapterError` code `unauthorized`;
  3. the transport saw no method other than `GET` (the read-only layer already refuses others).
- Expectations are added to each target's data (`expected.currentUser`) and to the recorded fixtures
  (`test/fixtures/<platform>/user.json` where one is not already recorded).
- Reused unchanged by feature 008.
