# GitLab review-actions fixtures

These fixtures are hand-authored from each platform's published API documentation. They are NOT recorded from a live platform: no request here was captured from a real server, so field details (ids, header sets, exact error wording) are plausible rather than verified. Treat them as a stand-in until recorded against a real account (see PRWB_RECORD_FIXTURES in test/helpers/recorded-fetch.ts), and re-check every response shape and error body at that point.

Format: the recorded-fetch shape (one entry or an array per file). Load a directory with recordedFetch("<platform>/review-actions"); it is self-contained and does not need the platform's top-level fixtures. Where several entries share a method and URL they are served in array order, then the last repeats.

Repository acme/widgets, pull request 1, head a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1, signed-in user alice-dev.

Error scenarios (errors.json): a comment POST on pull request N answers 2=403, 3=409 (not open), 4=422, 5=429, 6=401, 7=503, 8=network error (timeout, the ambiguous-failure case).

Base URL https://gitlab.example.test, project acme%2Fwidgets, merge request iid 1.

Files: user; version (16.11.2, an instance with no request-changes: the version-probed gap, so no request-changes endpoint is recorded and any call to one is unrecorded); variants/version-newer.json (17.8.0, NOT loaded by default; it only records the probe answer, and I did not author a request-changes endpoint because I am not sure of its documented REST shape); versions (MR versions for position shas); comment-pull-request (POST notes); comments-line ([single, line_range, 400 bad position], POST discussions); comment-reply; comment-edit; comment-delete; decision-approve ([approve, unapprove]); list-comments; my-decision (GET approvals); errors (POST notes).
