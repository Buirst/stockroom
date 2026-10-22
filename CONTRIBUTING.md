# Contributing

Thanks for helping. Stockroom has no dependencies: plain Node.js 18+.

1. Fork and clone the repo.
2. Run the tests: `node --test`.
3. Make your change with a test that fails without it.
4. Open a pull request saying what changed and why.

Bug reports are just as useful: use the issue templates, and include the output of
`node bin/stockroom.js status` (remove anything private first).

Rules of thumb:

- Never shorten or rewrite a tool's description in the catalog: entries are verbatim.
- Stockroom never turns a tool off without a plan the user approved, and every change can be undone.
- No network requests from Stockroom's own code.
