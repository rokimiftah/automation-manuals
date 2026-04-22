# SP1 Manual QA Checklist

1. Sign in as an admin using password.
2. Queue the GuardLogix sample manual from an official vendor URL.
3. Confirm the ingestion job transitions through `submitting`, `waiting_provider` or `processing_provider`, and finally `ready`.
4. If the provider queue is slow, confirm the admin UI keeps showing the waiting state instead of appearing stuck.
5. Sign in as an engineer with an allowed account.
6. Ask: `Where should the 1756-L7SP safety partner be installed relative to the primary controller?`
7. Confirm the answer includes at least one citation.
8. Click the citation and verify the PDF viewer opens the cited page.
9. Ask: `What does a solid red OK LED on the 1756-L7SP mean?`
10. Confirm the answer is grounded and actionable.
11. Ask a deliberately unsupported question and confirm the assistant refuses instead of guessing.
