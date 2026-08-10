# AI Engineering Lab

Interactive practice for AI engineering concepts. Every idea comes with
**questions a program can grade** and **a sandbox you can tune** — not another
tutorial you nod along to and forget.

Runs entirely in your browser. No backend, no accounts, no tracking.
Your progress lives in your own `localStorage`.

[中文说明](./README.zh-CN.md)

---

## Why this exists

I wrote 571 notes on AI engineering. They were accurate and thorough and
completely inert — reading them felt productive without producing much.

The diagnosis: the self-check questions at the top of each note were open-ended
("explain how X works"). Open-ended questions cannot be graded by a program, so
the only option is self-assessment. And self-assessment fails twice over — there
is no immediate feedback, and people systematically overrate themselves.

So this project starts from a hard constraint: **every question must be
machine-gradable.** That rules out "discuss the tradeoffs of X" and forces
questions with definite answers — which turns out to also force _better_
questions, the kind that test whether you can actually do the calculation.

## Design decisions

**Gradable, not self-assessed.** Numeric answers with explicit tolerances,
multiple choice with distractors drawn from real misconceptions. The program
decides, not your optimism.

**Wrong answers open content, not punish.** First miss shows a hint and lets you
retry. Second miss reveals the full derivation. Pick a wrong option and you get
an explanation targeting _that specific_ misconception.

**Spaced repetition, not daily streaks.** Correct answers get scheduled at 1, 3,
7, 16, and 35 days. There is deliberately no consecutive-day counter — streaks
reward _showing up briefly every day_, but deep technical material rewards
_two focused hours occasionally_. Those incentives point in opposite directions.

**No badges, no leaderboards.** A [survey of gamification in education
software](https://arxiv.org/abs/2305.08346) found badges, leaderboards,
competitions, and points to be the elements most frequently reported as causing
negative effects. The audience here is working engineers; a gold star reads as
condescension. What they actually want is to know what they don't know.

## Current content

**Five levels, 52 gradable questions** — backprop and dying ReLU, tokenizers and
cost, attention and causal masking, KV cache capacity planning, RAG chunking.
Nine of those questions run real Python in your browser. Three of the five levels
are dual- or triple-constraint sandboxes where you tune parameters until every
budget holds at once.

**168 notes, wired into the same path.** The learning path on the home page is
one data source: modules and sections come from the notes library, and each level
is attached to the section its background reading lives in. Notes link forward to
their companion level; levels link back to their background notes.

**Gradable questions inside the notes themselves (Tier A).** Notes can carry
machine-graded multiple-choice questions that share the judging engine and the
spaced-repetition schedule with level questions. Currently four notes are
covered; the pipeline and its gates are in place for the rest.

The KV cache sandbox is representative: a real serving scenario (Llama 2 70B,
batch 32, 4K context) with two budgets that must hold simultaneously — memory
under 45 GB and quality loss under 2%. Twelve configurations are reachable;
exactly three pass. You cannot win by picking the cheapest option every time —
MQA uses the least memory and still fails on quality.

## Development

```bash
pnpm install
pnpm exec playwright install chromium   # for component tests

pnpm run dev          # dev server
pnpm run check:all    # every gate: lint + typecheck + tests + smoke
pnpm run test:smoke   # build, then verify the full flow in a real browser
pnpm run build        # static output to build/
```

### Stack

SvelteKit 2 with Svelte 5 runes, `adapter-static`, Tailwind 4, Vitest 4
(unit tests in Node, component tests in real Chromium via Playwright).

Chosen for two reasons: Svelte compiles to a few KB rather than React's ~45 KB
gzipped, which matters because heavier interactive features are planned; and
swapping `adapter-static` for `adapter-cloudflare` or `adapter-node` is a
one-line change if a backend ever becomes necessary.

### Deployment

The build is fully static. `paths.relative` defaults to `true`, so all links and
assets are emitted as relative paths — the output works unchanged under a
subpath like `username.github.io/repo/` without configuring `paths.base`.

### Conventions worth knowing

Full list in **[AGENTS.md](./AGENTS.md)** — read it before contributing or
pointing an AI agent at this repo. Every entry there comes from a bug that
actually happened. Highlights:

- **`prerender = true` in the root `+layout.ts` is required** by
  `adapter-static`. Removing it breaks the build.
- **Internal links must use `resolve()` from `$app/paths`.** ESLint enforces
  this; it is also what keeps subpath deploys from breaking.
- **`QuizCard` does not reset itself when `question` changes.** Callers must wrap
  it in `{#key question.id}`. This is deliberate — full remount leaves no room
  for stale state.
- **Question numbers are verified by tests, not by hand.**
  `kv-cache-questions.spec.ts` recomputes every answer from the KV cache formula
  independently. Add a question with a wrong number and CI catches it.

## Contributing

Bug reports and fixes to the code are welcome. For new question sets, open an
issue first — questions need to reflect real engineering judgment, and getting
the numbers right matters more than volume.

## License

Dual license: code under MIT, educational content under a non-commercial
license. See [LICENSE](./LICENSE).

Content adapted from [571 notes on AI engineering](https://github.com/walterwang0x01/tech-learning-and-projects).
The author's [blog and briefings](https://walterwang0x01.github.io/portfolio/).
