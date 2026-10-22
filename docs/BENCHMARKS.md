# Benchmarks

Stockroom is measured two ways: a unit suite that runs on every push, and real Claude Code sessions on the author's
own setup, where what counts is whether Claude actually picks the right tool.

![Turned-off tools found and used, by version](assets/versions.png)

## Method

- **Setup.** The author's machine: about 580 installed tools (around 400 skills, 49 plugins, 34 MCP servers, 58 hooks),
  Windows 11, Claude Code 2.1, Opus. The skill listing is far over Claude Code's default budget, so descriptions get
  truncated: the situation Stockroom is built for.
- **Sessions.** Each case is one fresh `claude -p "<task>" --permission-mode plan --max-turns 6` session with the
  user's full environment, three at a time. Plan mode keeps the runs harmless; 6 turns keeps the cost down (see
  [Limits](#limits)).
- **Grading.** `stockroom e2e-grade` reads the session's stream: a case passes when Claude launched the expected skill
  or read its `SKILL.md` (by `Read` or through the shell). Rule cases pass when the answer or the written plan shows the
  rule was followed, and fail if the forbidden tool was launched. Every failure was also read by hand; where the grader
  and the reading disagree, both are reported.
- **One run per case.** Results move by about ±1 between identical runs. Trends across versions are what matter.
- Exams cost about $130 of real sessions in total (2026-10-21 and 2026-10-22).

## The four exams

| Exam | Cases | What passing means |
|---|---|---|
| **Turned-off tools** | 10 | The task needs a tool whose plugin or skill is off. Claude finds it in the catalog or map and reads its `SKILL.md` (or, where the user's own privacy rule says so, works locally instead) |
| **Traps** | 4 | Plain questions (a percentage, what a webhook is, the weekday of a date, a translation). Claude answers without reaching for any tool |
| **Turned-on tools, truncated listing** | 10 | The tool is on, but its description may be cut from the listing. Claude still launches it |
| **Rule traps** | 5 | A rule from the map must change what Claude does: a fake `HOME` for one skill, no posting without a yes, no client files to a cloud tool, the cost before generating, the deploy flags of one project |

## Turned-off tools, case by case

✓ pass · ✗ fail (grader). 0.1.2 and 0.3.1 were partly reruns of the misses, so only their totals are shown.

| Case | 0.3.0 | 0.3.3 | 0.3.4 | 0.4.0 | 0.4.1 |
|---|---|---|---|---|---|
| 30-second promo video of a website | ✗ | ✓ | ✗ | ✓ | ✓ |
| Same color grade on 40 product photos | ✗ | ✓ | ✗ | ✓ | ✓ |
| Mock API for a client's mobile app | ✗ | ✓ | ✗ | ✓ | ✓ |
| Tile set and tile rules in a game engine | ✓ | ✗ | ✓ | ✓ | ✓ |
| Catch production errors in a delivered app | ✗ | ✓ | ✓ | ✓ | ✓ |
| Postgres copy to test migrations | ✗ | ✗ | ✗ | ✗ | ✓ |
| Prepare a sales call from the CRM | ✓ | ✗ | ✓ | ✓ | ✓ |
| Scanned contract PDF to editable Word | ✗ | ✓ | ✓ | ✗¹ | ✓ |
| Route a five-city tour | ✓ | ✓ | ✓ | ✓ | ✓ |
| Burned-in captions on a video | ✗ | ✓ | ✓ | ✓ | ✓ |
| **Total** | **3/10** | **7/10** | **6/10** | **8/10** | **10/10** |
| Traps left alone | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |

Totals of earlier runs: 0.1.2 6/10, 0.3.1 6/10.

¹ Claude rejected the cloud tool because of the user's critical rule ("never upload client documents") and planned
local work, which is the intended behaviour; the grader of that day missed the phrasing and was fixed afterwards.

## Other exams

| Exam | 0.1.2 | 0.3.0 | 0.3.4 | 0.4.0 | 0.4.1 |
|---|---|---|---|---|---|
| Turned-on tools, truncated listing | 8/10 | 8/10 | **9/10** | — | — |
| Rule traps | — | 4/5 | 4/5 | 3/5² | **4/5** (5/5 with 12 turns) |

² By hand 4/5: the cost rule was followed (the plan opens with "Cost") but the session ran out of turns before its last
message. The deploy-flags case runs out of the exam's 6 turns in every version: it explores the theme first. With 12
turns it follows the rule (validate, then push only the changed file).

![Stockroom 0.4.1 scorecard](assets/scorecard.png)

## What changed, and why

Each version answered a failure the previous exam showed.

| Version | Change | Effect |
|---|---|---|
| 0.1.2 | Stronger session-start line: search the catalog before building | 3/10 → 6/10 on turned-off tools |
| 0.3.0 | Tool rules move into the map; the catalog marks off plugins | 3/10: Claude found the off tool but proposed turning its plugin on instead of reading its `SKILL.md` |
| 0.3.1 | Each map section gives the `SKILL.md` path; the line says an off tool works through it | 6/10 |
| 0.3.2–0.3.3 | The short index itself carries `(off: read <path>)` for off tools, since Claude only greps the index | 7/10; the three misses never opened the map |
| 0.3.4 | One-time reminder before a plan, a web search or a tool search, if the map was not checked | The three misses: 5/6 over two runs each |
| 0.3.5 | The reminder never fired on plan writes (rule path relative to the working folder; plans live in `~/.claude/plans`) | Fired in 12 sessions instead of 5 |
| 0.4.0 | Automatic shelf; on-use rules reach skills under `~/` (same path bug) | 8/10 with 79 more tools turned off |
| 0.4.1 | The reminder asks Claude to read the `SKILL.md` the map names, not only to grep | **10/10**; the last miss had found the tool but only named it in the plan |

## The shelf on a real setup

Measured on the author's setup with `"shelf": "usage"` (30 days) and `"auto": true`, same tools installed.

![Before and after on the author's setup](assets/context.png)

| What | Before | With Stockroom |
|---|---|---|
| Tool rules loaded in every session | 62,974 bytes (a hand-written tool guide) | 2,234 bytes (critical rules + hook line); other rules shown on use |
| Skills in the listing | 292 | 208 |
| Skill listing size | 84,189 characters | 75,224 characters |
| Tools turned off | — | 79, all still in the catalog |

The automatic shelf, checked live:

- A turned-off skill read through its `SKILL.md` was back on in `settings.json` immediately, logged in `auto.log`, and
  the session repeated Stockroom's notice word for word.
- A session started after the shelf ran had the off skills missing from its listing and the on ones present.
- The daily background run finished about 12 seconds after the session hook returned, with no errors.

## Speed and tests

![Speed](assets/speed.png)

| What | Result |
|---|---|
| Session start when nothing changed | about 200 ms (fingerprint 57 ms plus loading the code) |
| Full catalog of 602 tools | 73 ms; 0 descriptions missing or changed |
| Rule hook on a skill call or `SKILL.md` read | 45 to 70 ms over Node's own start-up (an empty Node takes 97 ms median on the same laptop) |
| Daily shelf run | about 10 s, in a detached process |
| Unit tests | 213, on Windows, macOS and Linux with Node 18 and 22 |

## Limits

- **One setup.** Every real session ran on the author's machine and tools. Other setups will differ.
- **One run per case.** Treat a single case flipping as noise; look at the totals across versions.
- **The 6-turn cap is the exam's, not Claude Code's.** It cuts sessions that explore before they answer. Normal sessions
  have no such cap.
- **Usage counts exam sessions.** The automatic shelf reads 30 days of transcripts, and exam sessions are transcripts
  too. Tools the exams read count as used.
- **The exam cases are not published.** They are written around the author's own projects and accounts. The grader
  (`stockroom e2e-grade`) and the method above are.
