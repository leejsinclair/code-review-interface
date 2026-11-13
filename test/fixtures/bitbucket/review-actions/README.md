# Bitbucket review-actions fixtures

These fixtures are hand-authored from each platform's published API documentation. They are NOT recorded from a live platform: no request here was captured from a real server, so field details (ids, header sets, exact error wording) are plausible rather than verified. Treat them as a stand-in until recorded against a real account (see PRWB_RECORD_FIXTURES in test/helpers/recorded-fetch.ts), and re-check every response shape and error body at that point.

Format: the recorded-fetch shape (one entry or an array per file). Load a directory with recordedFetch("<platform>/review-actions"); it is self-contained and does not need the platform's top-level fixtures. Where several entries share a method and URL they are served in array order, then the last repeats.

Repository acme/widgets, pull request 1, head a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1, signed-in user alice-dev.

Error scenarios (errors.json): a comment POST on pull request N answers 2=403, 3=409 (not open), 4=422, 5=429, 6=401, 7=503, 8=network error (timeout, the ambiguous-failure case).

Files: user; comment-pull-request; comments-line ([inline to=45, inline from=42 base side, 400 bad position], POST comments; Bitbucket inline has no line range, so no range is recorded and the adapter should report line ranges as not allowed); comment-reply (parent id); comment-edit (PUT); comment-delete; decision ([POST approve, POST request-changes]); decision-withdraw ([DELETE approve, DELETE request-changes]); list-comments; my-decision (GET pullrequests/1 with participants); errors.
