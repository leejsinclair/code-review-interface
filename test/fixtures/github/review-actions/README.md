# GitHub review-actions fixtures

These fixtures are hand-authored from each platform's published API documentation. They are NOT recorded from a live platform: no request here was captured from a real server, so field details (ids, header sets, exact error wording) are plausible rather than verified. Treat them as a stand-in until recorded against a real account (see PRWB_RECORD_FIXTURES in test/helpers/recorded-fetch.ts), and re-check every response shape and error body at that point.

Format: the recorded-fetch shape (one entry or an array per file). Load a directory with recordedFetch("<platform>/review-actions"); it is self-contained and does not need the platform's top-level fixtures. Where several entries share a method and URL they are served in array order, then the last repeats.

Repository acme/widgets, pull request 1, head a3f9c2e17b4d58e6f0a1c3b5d7e9f2a4c6b8d0e1, signed-in user alice-dev.

Error scenarios (errors.json): a comment POST on pull request N answers 2=403, 3=409 (not open), 4=422, 5=429, 6=401, 7=503, 8=network error (timeout, the ambiguous-failure case).

Files: user; comment-pull-request (POST issues/1/comments); comments-line ([single line, range with start_line, 422 anchor refused], POST pulls/1/comments); comment-reply; comment-edit (PATCH pulls/comments/5001, then issues/comments/9001); comment-delete (DELETE, both kinds); review-submit ([APPROVE, REQUEST_CHANGES], POST pulls/1/reviews); review-dismiss (PUT reviews/7002/dismissals, withdraw); list-comments; list-reviews; errors.
