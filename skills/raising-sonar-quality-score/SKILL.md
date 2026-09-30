---
name: raising-sonar-quality-score
description: Use when a Java/Gradle service needs its SonarQube/IDP quality score raised — closing a JaCoCo coverage gap toward a target percentage, bumping stale quality tooling (Checkstyle, OWASP dependency-check, ErrorProne, JaCoCo), or verifying a batch of new tests didn't quietly change an API contract. Technology-specific: Java + Gradle + JaCoCo + SonarQube.
---

# Raising SonarQube Quality Score

## Overview

A repeatable playbook for taking a legacy Java/Gradle service from a mediocre
Sonar/IDP quality score to a passing one — coverage, bugs, vulnerabilities,
maintainability, duplications — without changing what the service does.
Built from a real run (product-service: 58.6% → 99% line coverage / 92.4%
Sonar coverage, 0 bugs, 0 vulnerabilities, A ratings across the board, 661
tests, quality gate OK) and the mistakes made getting there.

**Core principle:** the biggest risk in this work is never "can't write enough
tests" — it's silently changing behavior (a weakened assertion, a production
tweak to make something "testable") while chasing a number. Every step below
exists to make "nothing changed" a checkable fact, not a claim.

## When to Use

- A Sonar/IDP dashboard shows a service below its coverage/quality gate target.
- You're about to write a batch of tests purely to move a coverage number,
  across many files/packages at once.
- Checkstyle, OWASP dependency-check, ErrorProne, or JaCoCo are pinned to
  versions nobody has looked at in years.
- You need to prove, not assert, that a large test-writing pass changed zero
  production behavior.

**Don't use for:** actual feature work, or a coverage gap on a single small
class (just write the tests — this playbook's overhead pays off at
multi-package scale).

## Target

Default to **95% line coverage AND 95% branch coverage** — two separate
bars, checked separately in step 8. Sonar's own blended "coverage" metric
can look fine (>90%, passing) while branch coverage lags far behind it; the
blended number alone will hide exactly that gap.

**Exception — recognize "coverage math" before writing to it.** Some gaps
are cheap to close because they reflect genuinely-undertested logic; others
are expensive and reflect nothing but a mechanical pattern's branch count —
most commonly a hand-written `equals()`/`hashCode()`/builder over many
fields, where full branch coverage needs roughly one near-identical test
per field (mutate exactly this field, assert the outcome changes) and the
fourth such test catches nothing the first three didn't already prove.
**When closing one method's branch gap would take more than ~10
near-identical tests, stop and report the actual cost — how many tests,
roughly what they'd look like, what number they'd move — to the user before
writing any of them.** 95% is the default target, not an unconditional
mandate; a target that costs real time for zero real defect-catching value
is exactly the kind of judgment call this skill elsewhere insists gets
surfaced, not resolved unilaterally (see Forbidden below).

If the user still wants the number after hearing the cost, prefer one
parameterized/table-driven test (one method, N data rows) over N separate
hand-written test methods — same coverage effect, a fraction of the code.

## Forbidden — no exceptions

**Never change an API contract** — request/response JSON shape, field names,
error-response shape, status codes, anything a consumer of this service
observes from outside. This work is coverage/quality-tooling hardening, not
a refactor. If closing a gap seems to require a contract change, it doesn't —
find a different way to test the existing behavior, or stop and ask.

**Never modify production code to make something "more testable"** without
flagging it to the user first and getting an explicit answer. Test-only means
test-only. A production change that's "obviously harmless" is still a
production change nobody agreed to.

**Never weaken, delete, or loosen an existing test assertion** to make a
newly-discovered mismatch go away. If an existing test's expectation doesn't
match what you'd naturally assert today, that's a signal to look closer
(see the `UnusedVariable` row in Common Mistakes below), not license to
adjust it.

**Never accept "no contract changed" as a self-report** — yours or anyone
else's. Verify it per step 6, every time, even when you're confident.

| Rationalization | Why it doesn't hold |
|---|---|
| "It's just a tiny production tweak, totally harmless" | Not your call — flag it, don't decide it unilaterally |
| "This existing assertion is basically the same, I'll just adjust it slightly" | This is exactly the shape a real contract regression takes when it slips through disguised as a test fix |
| "I already checked, nothing changed" | Checked how? If you can't point to a diff, you don't have evidence, you have an impression |
| "It's just a version bump, contracts can't be affected by that" | Usually true, not always (a serialization library bump can change default output) — verify anyway, it's cheap |
| "The coverage number matters more right now, I'll clean this up after" | There is no "after" — merge it wrong once and the regression ships |

## Blocker — critical runtime packages need explicit sign-off

Quality-tooling bumps (Checkstyle, ErrorProne, JaCoCo, OWASP dependency-check,
the Sonar scanner plugin) are static-analysis/build-time tools with zero
runtime footprint — bump those freely as part of this work. **Database
drivers, schema-migration tooling, and live external-infra clients (cache,
message-broker) are a different risk category and are blocked by default:
stop and get explicit user confirmation before touching their version, even
if you're only in `build.gradle` already for an unrelated reason.** A subtle
behavioral difference in these directly risks data loss, a broken migration,
or a production outage — categorically worse than anything a lint-tool
version can cause, and far harder to notice in a test suite that doesn't hit
a real database/cache/broker.

Categories to watch for (not exhaustive — the pattern is "touches persistent
state or a live external system directly," not a specific list of names):
- **Database drivers** — both the one your app actually runs on (e.g. an
  R2DBC driver) and any separate one used only by tooling (e.g. a plain JDBC
  driver used solely by a migration task) — the latter is easy to miss
  precisely because it's not on the app's own runtime classpath.
- **Schema-migration tooling** (Liquibase, Flyway, or equivalent) and its own
  dependency chain (e.g. a CLI-arg-parsing library it pulls in). One
  exception worth naming: bumping the migration tool's own Gradle *plugin*
  (not the schema-execution engine itself) purely because a newer Gradle
  wrapper version — landing as part of an unrelated framework bump — can no
  longer resolve the old plugin, is a build-tooling compatibility fix, not
  a schema/behavior change, and doesn't need this Blocker gate. Bumping it
  for new migration *features* still does.
- **Cache/queue/broker clients** actually used against a live external
  system in production (a Redis client, a Kafka client) — as opposed to a
  serialization/codec library used *by* one of those, which carries lower
  risk on its own.

Concrete example from the run this skill is based on, all confirmed still
pinned at their pre-migration versions and left alone on purpose: a
migration-only JDBC Postgres driver (distinct from the R2DBC driver the live
app actually uses, which *did* move as a side effect of the framework BOM
bump — don't confuse the two), the Liquibase core library itself, that same
migration task's CLI-parsing dependency, and the Redisson client used for
the app's live Redis cache. None of these were in scope for a quality-tooling
pass and none were touched — cited here as illustration of the category, not
as a list to check off; a different service will have its own equivalents.

## Quality-tooling packages (reference, not exhaustive)

The tools you'll typically be checking/bumping for this kind of work —
**always look up the actual current version yourself (Maven Central / the
Gradle Plugin Portal) rather than trusting any number written down here or
anywhere else; it will be stale by the time you read it.** This list is a
starting point for where to look, not a complete audit — a given service may
have other stale quality/build tooling beyond these five, and everything in
the Blocker above is explicitly out of scope for this list.

- **Checkstyle** — major-version jumps (e.g. 9→10) surface new
  default-ruleset violations on the next run; that's the newer ruleset, not
  a sign anything regressed. Expect mechanical fixes (indentation,
  unused imports).
- **OWASP dependency-check** (Gradle plugin) — needs `autoUpdate=true`, a
  pre-seeded local NVD DB, or an `nvdApiKey` to actually produce a report —
  see step 8. If the job instead fails during Gradle's own configuration
  phase over a repository credential property that the CI job never
  receives, that's not a dependency-check problem at all — it's a
  `repositories {}` block requiring auth for a repo that's actually public.
  Verify with a raw unauthenticated request against that repo URL before
  adding credentials; a sibling service pointed at the same repository
  without requiring any is stronger evidence than the request succeeding
  alone.
- **JaCoCo**
- **ErrorProne** (Gradle plugin and core analyzer are versioned separately —
  check both)
- **SonarQube Gradle plugin** — server-side, a self-hosted Community Build
  instance now requires `sonar.host.url` passed explicitly or the scanner
  defaults to targeting SonarCloud — see step 8.

Runtime/framework versions (Java, Spring Boot, Gradle wrapper itself) are
service-specific and out of scope for this list — this skill is about the
quality-tooling layer, not the app's own stack.

## Workflow

```
1. Get a REAL baseline           (not last quarter's dashboard number)
2. Design the work split, present it, wait for the user's answer — quoted
3. Write a self-contained brief  (planning-with-files, one dir for the run)
4. Execute sequentially, module by module
5. One consolidated build after each module (not batched at the end)
6. Verify no contract changed    (mechanically, not by asking — every module)
7. Bump stale quality tooling
8. Re-run the real analyzer      (Sonar itself, not just your own coverage math)
```

### 1. Get a real baseline — tests green, then both coverage metrics

Before anything else, run the full existing test suite once, clean, and
confirm it passes — note the count. Any failure discovered later in this
pass is then unambiguously new, not a pre-existing failure getting
misattributed to this work.

Then run the actual build's coverage task (`./gradlew test jacocoTestReport`,
or your multi-module aggregate report task) fresh — don't reuse a stale
report sitting in `build/`.

**Line coverage**: parse the JaCoCo XML yourself with
[`parse-jacoco-coverage.js`](parse-jacoco-coverage.js) in this directory
rather than eyeballing the HTML report or writing a quick regex:

```bash
node parse-jacoco-coverage.js path/to/jacocoTestReport.xml
```

It handles two non-obvious JaCoCo XML gotchas that will otherwise produce
confidently-wrong numbers (see the file's own header comment for why):
self-closing `<class/>` elements (pure marker interfaces) silently stealing
the *next* class's coverage data under a naive regex, and the first
`<counter type="LINE">` inside a class being a method's, not the class's own
aggregate. It also filters out generated code (protobuf/avro/MapStruct
`*Impl` — edit the prefix/suffix lists at the top for your project's own
generated packages) so the total matches what Sonar's `sonar.sources`
actually scopes in, not JaCoCo's raw (much larger) bytecode-level count.

**Branch coverage**: the JaCoCo XML has `<counter type="BRANCH">` data too,
but the more direct source — since it's what the quality gate actually
reads — is Sonar's own API, once at least one `sonar` analysis pass has run
(see step 8 for pointing it at a local instance). Yes, this means touching
the "real analyzer" once now, before changing anything, and again at the
end to confirm the final numbers — both runs matter, step 8 isn't the only
time you use it. Query the component tree sorted by where the gap actually
concentrates, not by percentage alone:

```bash
curl -u <token>: "http://<host>/api/measures/component_tree?component=<projectKey>&metricKeys=branch_coverage,uncovered_conditions,conditions_to_cover&qualifiers=FIL&ps=500&s=metric&metricSort=uncovered_conditions&asc=false"
```

Sort by `uncovered_conditions` (an absolute count), not `branch_coverage` (a
percentage) — a small file sitting at 25% branch coverage might be 3 total
conditions, while a large file at 84% can still be the single biggest
contributor in absolute terms. This is exactly how one class's hand-written
`equals()` turned out to be 61% of an entire project's branch-coverage gap
(see the Real-World Impact Log) — invisible from percentages alone.

**Sanity check your numbers**: if you have any prior "coverage was X%" claim
lying around (a doc, a memory, an earlier session), it's worth distrusting
until this fresh parse confirms it independently — coverage numbers rot fast
and a stale one will misdirect the whole work split in step 2.

### 2. Design the work split, write it to disk, present it, wait

Group by package/module, sized by **missed-line count**, not raw class
count — one dominant class can be half the whole gap. For each group, note:
the exact classes and their current missed/covered numbers, which already
have a test file to extend vs. need one created from scratch, and any
existing sibling test in the same package to use as the style reference.
Order the groups biggest-gap-first — that's usually also the highest-value
work, and finishing it early means the smaller, easier groups can be cut if
time runs out without losing the bulk of the gain.

**Write this to disk before presenting it — `planning.md` is explicit that
"a plan that only exists as reasoning or a narrated summary is not
complete."** Write it as `.planning/<service-slug>/task_plan.md` — the same
file step 3 keeps using for the rest of the run, not a separate document;
one artifact serves both planning.md's on-disk requirement and
planning-with-files' role, from the start, instead of writing the plan
twice in two different shapes.

**Before writing a single test, present that file's content to the user
as a plan — same discipline `planning.md` requires beyond the file itself:
an explicit "Decisions for user confirmation" list (any Blocker-category
package this gap touches, any module you're about to skip or descope,
anything not dictated by the numbers alone) plus any open questions, and a
hard stop until the user has answered every item in their own words.**
Don't infer a yes from silence, don't treat your own confidence in a call
as the user having made it, and don't log something as "confirmed" without
quoting their actual answer next to it. This is exactly the same failure
mode the Forbidden section's rationalization table already covers for
mid-run decisions — it applies just as much to the plan itself, before
execution starts. (The Target section's "coverage math" cost-report is the
same gate, reused later if a module's branch gap turns out to need it —
not a separate ad hoc ask.)

### 3. Keep a self-contained brief — planning-with-files, adapted for solo sequential use

`task_plan.md` from step 2 is the first of three files from the
[planning-with-files](https://github.com/OthmanAdi/planning-with-files)
methodology, adopted from the start rather than as an afterthought — it
exists for exactly this resumability problem: a run that spans more than
one sitting (a context compaction, a rate limit, closing the laptop)
shouldn't have to re-derive its baseline and progress from scratch. Its
original design isolates one directory per *parallel* worker; since this
skill runs sequentially instead (see below), it's one directory for the
whole pass rather than one per module:

- `.planning/<service-slug>/task_plan.md` — written in step 2, checked off
  module by module as execution proceeds.
- `.planning/<service-slug>/findings.md` — append-only: Blocker-category
  packages left alone, "coverage math" exceptions invoked, anything
  discovered that isn't obvious from the plan.
- `.planning/<service-slug>/progress.md` — append-only: which module was
  just finished and its before/after numbers, in order.

A resumed session reads these three files first and picks up exactly where
the last one stopped, instead of re-parsing coverage reports to figure out
what's already done. This isn't ceremony for its own sake — it's what keeps
a long sequential run from drifting scope module to module, and it's what
step 6 checks against.

**Do this sequentially, module by module — not as a swarm of parallel
agents/workers.** Parallelizing this kind of work looks appealing (more
modules done per wall-clock minute) but in practice costs meaningfully more
total tokens (each parallel worker re-derives context and rebuilds
independently, with no shared cache) and introduces real correctness risk
that sequential execution doesn't have: cross-worker isolation gaps (a
worker isolated via a git worktree only sees the last *commit*, which — mid-
migration, with substantial uncommitted work in progress — can mean an old
tool/lint config nobody meant it to run against), and code from one worker
merging cleanly on its own but failing once combined with another's changes
in the same build. One sequential pass, one continuous environment, avoids
all of it and is more precise for exactly the reason it's slower: nothing
merges until it's already known to build clean in the one and only tree that
matters.

### 4. Execute sequentially, module by module

Work through the groups from step 2 in order. For each: write the tests,
run that module's own test + coverage task, confirm the new numbers, then
move to the next module. Don't defer verification to the end — see step 5.

### 5. One consolidated build after each module

After each module (not batched until the very end), run the *full* project
build — `clean test` plus your aggregate coverage report task — not just the
module you just touched. A change that's clean in isolation can still fail
once the whole project compiles together (see the `Checkstyle`/`ErrorProne`
row in Common Mistakes: code that passes in one lint config can fail under
another). Catching that after one module is a small fix; catching it after
five is a much bigger one to untangle.

### 6. Verify no contract changed — mechanically, every module

Don't accept "no production code touched" as a self-report — check it, after
every module, not just once at the end:

- **No production file changed at all**: compare modification times against
  a build artifact known to predate this module's work (e.g. `build.gradle`,
  if untouched since before this pass started) — any `src/main` `.java` file
  newer than that is a change to look at directly.
- **Existing assertions weren't touched**: for every contract-sensitive file
  (API controllers, request/response mappers, DTOs) that shows as *modified*
  rather than new, diff it against the pre-module version and filter to only
  the *removed/changed* lines (`diff old new | grep '^<'`). Pure test
  additions produce zero output here.
- **When a contract-sensitive shape lives in a third-party library, not
  your own repo** (a shared exception-handling library's response DTO,
  a serializer's own default config) — diffing your own `src/main` proves
  nothing about it. Decompile and diff the two library jar versions
  directly (`javap -p -c -constants` on the extracted `.class` files) to
  confirm the library's own request/response classes and defaults didn't
  change, rather than trusting its changelog or assuming "the version
  didn't change, so neither did the shape."

**If any of these checks turns up anything — stop.** A changed production file, a
removed/altered assertion, or a shape change in a library you depend on is
a Forbidden-category incident, not a loose end to tidy up before moving on. Don't fix it yourself and don't decide it
was probably fine: report exactly what changed (the diff itself, not a
paraphrase) to the user through the same confirmation gate as step 2, and
wait for their direction before touching the next module.

This is the single highest-leverage check in the whole playbook. It converts
"I'm confident nothing changed" into a fact anyone can re-run.

### 7. Bump stale quality tooling

Check the actual current version of each package from **Quality-tooling
packages** above (and anything else stale that isn't on that list — it's a
starting point, not the full set) directly against Maven Central / the
Gradle Plugin Portal. Bump one at a time and rebuild — a multi-major-version
jump (e.g. Checkstyle 9→10) will surface new rule violations from the newer
default ruleset, not from your code having gotten worse. These are almost
always mechanical (indentation, unused-import) — but check `UnusedVariable`-
style flags on a captured value that's compared to nothing before deleting
it: it may mean a missing assertion, not dead code (see Common Mistakes).
Anything matching the **Blocker** categories above stays untouched unless the
user explicitly signs off on it.

### 8. Re-run the real analyzer

Your own JaCoCo math is a proxy — confirm against the actual tool before
calling it done:

- **SonarQube**, if self-hosted for local iteration: pass `sonar.host.url`
  and `sonar.token` explicitly on the command line. Don't rely on an
  environment variable set in an earlier session — shell state doesn't
  persist across a long gap, and the scanner will silently default to
  targeting SonarCloud instead of your local instance if `sonar.host.url`
  isn't given, producing a confusing "not authorized / missing
  `sonar.organization`" failure that has nothing to do with your code.
  Sonar's own "coverage" metric blends line *and* branch/condition coverage
  — expect it to differ from a pure-line-coverage number from step 1; that's
  not a discrepancy to chase, both can be simultaneously correct.
- **OWASP dependency-check**, if configured with `autoUpdate = false`: it
  requires a pre-seeded local NVD database and will fail with
  `NoDataException` on any machine that's never successfully run it with
  updates enabled — this is an environment-provisioning gap, not a
  regression from anything in this pass. Needs `autoUpdate = true` (slow,
  needs NVD network access), a shared pre-populated DB, or an `nvdApiKey`.

## Common Mistakes

**General principle, before reporting any of the below as a quality
problem**: check whether it would fail identically on a machine that
changed nothing at all — a missing local database, a stale environment
variable, a stopped container. An environment-provisioning gap gets
reported as an environment-provisioning gap, not folded into "here's what's
wrong with the code." The last two rows below are both instances of this.

| Symptom | Real cause | Fix |
|---|---|---|
| A tiny marker interface shows an "impossible" huge missed-line count | Self-closing `<class/>` stole the next class's data in a naive parser | Use a real tag-scan parser (see script), not `<class>...</class>` regex pairing |
| Coverage % looks far too low right after removing a broken `jacoco.includes`/exclude filter | Generated code (proto/avro/MapStruct `*Impl`) is being counted; it's outside Sonar's `sonar.sources` | Filter generated packages out before comparing to any Sonar-derived target |
| `ErrorProne`/`Checkstyle` flags a captured variable ("`UnusedVariable`") that looks like leftover test scaffolding | The variable was meant to be compared against the actual result, and the comparison was never written — a real, silent test gap | Check the production method's real logic before deleting; often the fix is adding the missing assertion, not removing the variable |
| Sonar flags an equals/hashCode contract violation (Reliability bug) on a Lombok `@Data` entity | A hand-written `equals()` or `hashCode()` was added — for a real reason, e.g. excluding a field Lombok's default would include — without touching the other; Lombok still auto-generates the *other* one over a different field set, and the two silently disagree | Hand-write both together (or neither); if only one needs customizing, use `@EqualsAndHashCode` with an explicit `exclude`/`of` instead of writing either method by hand |
| A module's tests fail to compile only after the full-project build, over rules that passed fine when that module built alone | Different lint/tool config than the rest of the project was active when it was written (e.g. an isolated environment on a stale commit) | Always run the full-project build per step 5, not just the module you touched |
| `sonar` Gradle task fails with "not authorized" + "must define sonar.organization" against a **local** Sonar instance | Scanner defaulted to targeting SonarCloud because `sonar.host.url` wasn't passed explicitly | Always pass `-Dsonar.host.url=http://localhost:<port> -Dsonar.token=...` explicitly, every session |
| `dependencyCheckAnalyze` fails immediately, `NoDataException` | `autoUpdate=false` with no local NVD DB ever built on this machine | Environment gap, not a regression — see step 8 |
| Every IDP Sonar check fails with `Component key '<service>' not found` (404) | Nothing was ever published under that key — usually the CI sonar job dies before running (e.g. `repositories {}` interpolating `"${artifactory_user}"` from a gitignored `gradle.properties`), or the analysis goes out under a different key | Fix publishing first; no test moves a 404. Compare with a sibling on the same CI template, `curl -sI` the repo unauthenticated, and grep the workspace for who reads the credential property |
| Sonar coverage sits well below the JaCoCo number, and Sonar's `lines_to_cover` is larger than the JaCoCo total | Classes excluded only from the JaCoCo report (a `classDirectories`/`jacocoCoverageExclusions` filter) still count in Sonar as fully uncovered | Diff `lines_to_cover` vs the JaCoCo total — the gap is exactly those classes. Test them (team precedent) or mirror into `sonar.coverage.exclusions` — decide with the user, and keep JaCoCo and Sonar measuring the same set |
| Sonar coverage 0.0% on a multi-module build; log shows `No coverage report can be found` once per submodule | Relative `sonar.coverage.jacoco.xmlReportPaths` is resolved against each submodule's own dir | Make it absolute: `"${rootDir}/build/reports/jacoco/<task>/<task>.xml"` |
| Local project shows "The main branch of this project is empty" | Standalone scanner CLI (`docker run sonar-scanner-cli -Dsonar.sources=/usr/src`) run from Git Bash — MSYS rewrites `/usr/src` | Use the Gradle-plugin `sonar.sh` (assinatura-job's), which also reads the JaCoCo path from `build.gradle` |

**On the equals/hashCode row above**: fixing it produces a diff that *reads*
like a design decision (a hand-written `equals()` appearing where there
wasn't one before) even though it's a correctness fix — say so explicitly
in the commit message ("fix equals/hashCode contract violation,
`hashCode()` already excludes field X" reads as a bugfix; a bare "add
equals()" reads as a semantics change). A reviewer without the Sonar
finding in front of them has no way to tell "someone deliberately changed
this entity's identity semantics" apart from "someone fixed a bug," and
will reasonably flag the former as a risk to re-verify from scratch. See
`upgrading-java-spring-stack`'s log for a real instance of exactly that
happening in a later review pass.

## Real-World Impact Log

Append-only history of real applications of this skill, kept in a separate
file — [`real-world-impact-log.md`](real-world-impact-log.md) — so loading
this skill doesn't drag the whole history with it every time. Same reason
this org's `lessons.md` gives for living apart from `coordinator.md`: its
own header states "Not fetched every step on purpose, so the mandatory
files stay short." The append-only discipline itself — add an entry after
*every* run, don't just write one and stop — is what `coordinator.md`'s own
"Growing `lessons.md`" section requires of appending to that file; the same
discipline applies here, one directory over.

**Add a new dated entry there every time this skill is used on a
service — not just the first.** Don't edit a previous entry except to fix
an error in it.

## Not Yet Done

This skill hasn't been through the RED-GREEN-REFACTOR pressure-testing cycle
`writing-skills` prescribes for discipline-enforcing skills (baseline-without,
write, baseline-with, close loopholes). It's written from one real, detailed
run rather than validated against a fresh agent under pressure. Treat step 6
especially as something to sanity-check yourself the first few times you use
it, and feed anything that doesn't hold up back into this file.
