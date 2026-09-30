# Real-World Impact Log — raising-sonar-quality-score

Append-only. One dated entry per service this skill has been used on. Cover:
service name/date, before/after numbers for *both* coverage metrics, what
quality tooling was bumped, any Blocker-category package deliberately left
alone, and anything this run learned that a future run should know before
hitting it again — same spirit as the skill's own `Common Mistakes` table,
just log-shaped instead of table-shaped. Don't edit a previous entry except
to fix an error in it.

## 2026-08 — product-service

Java 25 / Spring Boot 4.0.2 / Gradle 9.5.1, ~2500 coverable lines across 3
Gradle modules. Baseline 58.6% line coverage → 99.01% (JaCoCo) / 92.4%
(Sonar's blended metric) / 68.7% branch coverage. Checkstyle bumped
9.2.1→10.26.1; OWASP dependency-check confirmed already ahead of a sibling
service's pinned version. Final Sonar quality gate: OK — 0 bugs, 0
vulnerabilities, A rating on Reliability/Security/Security
Review/Maintainability, 0.4% duplication, 661 tests passing.

Line coverage cleared the 95% Target; branch coverage (68.7%) did not, and
closing it was evaluated and explicitly declined — this is the run that
produced the Target section's "coverage math" exception. The dominant single
cause was one class's hand-written `equals()` comparing ~140 fields (134 of
the project's 218 total uncovered conditions) — closing it to 95% branch
coverage would have taken on the order of 130 near-identical "mutate one
field, assert not-equal" tests for almost no real defect-catching value past
the handful already written. Decision: left it, kept the already-passing
blended-metric quality gate as the real bar for this service, and folded the
tradeoff into the skill itself instead of re-deriving it next time.

This run actually used 6 parallel workers rather than the sequential
approach the skill now prescribes — and paid for it: one worker's work
landed in a git worktree pinned to the pre-migration commit (wrong Gradle
version, missing current lint rules) and needed a full manual recovery
pass; merged work from two other workers needed additional fixes once
built together under the real project's ErrorProne/Checkstyle config that
neither worker's own isolated build had caught. Total token cost across the
six workers exceeded 1.5M tokens for work a single sequential pass would
have done for a fraction of that, more slowly in wall-clock time but
without either failure mode. That's the concrete basis for the skill's
step 3/4 guidance — not a theoretical preference.

The contract-verification check (step 6) caught nothing wrong in this run
— its value was turning "I'm confident" into "here's the diff proving it,"
not finding a real violation.

## 2026-08 — product-service, MR review round (same engagement)

Follow-up to the entry above, from a later pass reviewing the actual merge
request built on top of this work — one thing from that entry needed a
closing note here, once an outside reviewer looked at the same code with
none of this log's context.

The hand-written `equals()` on `SkuEntity` that the entry above already
names as the dominant branch-coverage-gap contributor exists for a
specific reason worth recording precisely, since it wasn't visible from
the diff alone to that later reviewer: the entity has `@Data` (Lombok),
which auto-generates `equals()` and `hashCode()` together, in sync. A
`hashCode()` had been hand-written at some point, over a narrower field
set, for reasons unrelated to this pass — Lombok stopped generating that
one method but kept generating `equals()` over the full field set, so the
two silently disagreed: a genuine equals/hashCode contract violation,
flagged by Sonar as a Reliability bug. The fix was a hand-written
`equals()` matching the hand-written `hashCode()`'s exact field set — this
is the same class the Target section's "coverage math" exception is about,
and the fix is what produced the ~140-field `equals()` that section
describes.

A later code reviewer, seeing that hand-written `equals()` appear in the
diff with no context, reasonably read it as a possible
identity→value-semantics change on the entity and flagged it as a risk to
verify from scratch — it wasn't one (the class was already value-semantics
via Lombok either way; the fix restored a broken contract rather than
changing one), but confirming that took a full round of investigation that
a one-line commit-message note would have made unnecessary. This is the
concrete instance behind the Common Mistakes section's new equals/hashCode
row and its "say so in the commit message" note, both added directly
because of what happened here.

Two smaller findings from the same review round, tied to this skill's step
6 rather than to coverage numbers: verifying "no contract changed" for a
shared exception-handling library's response DTOs (unaffected by a major
version bump forced by an unrelated framework migration happening in
parallel) required decompiling and diffing the library's own two jar
versions directly — diffing this service's own `src/main` proved nothing
about a shape that lives entirely inside a dependency. That's the concrete
case behind step 6's new third bullet. Full detail on the migration side of
that same review round — two genuine runtime-only bugs a green build+test
never caught, and a serializer's stricter deserialization coercion — lives
in `upgrading-java-spring-stack`'s own log instead, since neither one is a
coverage/quality-tooling concern.

## 2026-08 — product-service, dependency-check pipeline fix

Small, standalone finding from the same overall engagement, filed and
fixed as its own card: the `dependency_check` job failed during Gradle's
configuration phase, before OWASP's own scanner ever ran, because the
`repositories {}` block demanded `artifactory_user`/`artifactory_password`
for a Nexus mirror that CI jobs don't receive. Confirmed the repository
needed no auth at all with a plain unauthenticated `curl` against it, and
independently confirmed a sibling service pointed at the same repository
without requiring credentials either. Fix was deleting the requirement,
not adding the missing properties. This is the concrete case behind the
new caution on the OWASP dependency-check bullet in Quality-tooling
packages above: a dependency-check job can fail for a reason that has
nothing to do with dependency-check.

## 2026-09 — assinatura-job

Java 11→25 / Spring Boot 2.1.2→4.0.5 / Gradle 4.10.3→9.5.1 on a pure cron job
(no web layer at all), run together with `upgrading-java-spring-stack`. IDP
quality score 14/28 at the start. Coverage 69.2%→**87.7%** line, 51.4%→**71.9%**
branch, 65.6%→**84.4%** blended; 205→261 tests; 1 bug→0; Reliability D→A;
Security, Security Review and Maintainability already A; duplications 1.5%.
Tooling added from scratch rather than bumped: SonarQube plugin 2.7.1→7.1.0.6387,
OWASP dependency-check 12.2.0, ErrorProne 3.1.0/core 2.40.0, JaCoCo 0.8.2→0.8.14.

**The headline lesson: a JaCoCo bump can move the coverage denominator, not just
the numerator.** Line coverage appeared to jump 59.65%→69.08% before a single
test was written. Cause: newer Lombok annotates generated members with
`@lombok.Generated` and JaCoCo 0.8.14 filters them, while 0.8.2 did not. 261 of
336 classes became empty `<class/>` elements and total coverable lines halved
(3110→1546). Verified rather than assumed — `PaymentMethodRequest` (60 missed
lines at baseline) went to zero coverable lines, and `javap` confirmed
`lombok/Generated` in its bytecode. Two consequences worth carrying forward: a
pre/post-bump coverage comparison is meaningless across a JaCoCo major bump, and
this *removes* the Target section's "coverage math" problem for free — the
generated builder/getter padding that makes equals/builder classes expensive to
cover simply stops being counted. Check which JaCoCo version produced any
baseline number before trusting a comparison against it.

**Step 6's mechanical check earned its keep, in the cheap direction:** the whole
coverage phase was verifiable as test-only with one command
(`git diff <phase-start>^..HEAD --stat -- '*/src/main/*'` → empty), because the
phase had a clean commit boundary. Starting the coverage work from a known commit
makes that check a one-liner instead of a file-by-file timestamp comparison.

**The `UnusedVariable`-means-missing-assertion row fired twice, both real.**
`CustomerSearchDataMapperTest` computed a result, discarded it, declared an unused
local and then called `assertNull(null)` — asserting nothing at all. And the only
bug SonarQube reported on the whole project (`java:S5845`, CRITICAL, the sole
reason Reliability was D) was `assertNotNull()` on an `int` in
`DeliveryWayEnumTest` — autoboxed, never null, equally vacuous. Both were fixed by
writing the assertion that was missing, not by deleting the variable. Worth
noting that a single CRITICAL issue *inside test code* was enough to drag the
project's Reliability rating from A to D.

**ErrorProne's first run on a legacy codebase found two genuine bugs among 15
findings**, which is a better hit rate than "mechanical cleanup" implies:
`ofPattern("dd/MM/YYYY")` (week-based year — wrong year around New Year, on a
date sent to the order API) and a `String.format` with an argument but no
placeholder (the signature id never reached the error log meant to identify it).
Both would have been invisible to a reviewer reading the diff. The other 13 were
indeed mechanical.

**Also worth copying:** the sibling services' `sonar.sh` scripts all hardcode
`PROJECT_KEY="sonar-instance"`, so every service analysed locally overwrites the
same project, and they hardcode a token in the committed script. This run used
the real service name as the key (which is also what the IDP queries) and read
the token from the environment. One of the two sibling tokens had already
expired, which is exactly the failure mode a committed token produces.

## 2026-09-30 — sku-data-service

Java 21 / Spring Boot 3.3.13 / Gradle 8.14.5, 4 Gradle modules, no stack bump
(out of scope — Java 21 and Boot 3.3 still pass the IDP's minimum checks). IDP
score 79% (22/28) at the start, with **all six Sonar checks failing on a 404**
(`Component key 'sku-data-service' not found`), not on a bad rating. Sonar
(local, blended) coverage 88.0%→**97.8%**; line 87.8%→~99.4%; branch 89.2%→89.5%
(branch modules scoped but not done in this run); Reliability C→A (2 issues→0);
Security, Security Review, Maintainability A throughout; duplications 7.4%;
318→349 tests. Quality tooling already current (sonar plugin 7.3.1.8318, OWASP
12.2.2, JaCoCo 0.8.15, ErrorProne 2.50.0) — nothing bumped.

**Headline lesson: a Sonar check failing with 404 is a publishing problem, and no
amount of test-writing moves it.** Root cause was the same one product-service's
dependency-check fix found a month earlier, surfacing through a different job:
`repositories {}` interpolated `"${artifactory_user}"`/`"${artifactory_password}"`
from a gitignored `gradle.properties`, so in CI Gradle aborted at configuration
time and the sonar job never published anything. Diagnosed by comparing against
the siblings rather than the CI template: a first hypothesis blamed the
`java-21` CI template (the three `java-25` services all published), and it died
the moment the user pasted IDP pages for search-retail and catalog-service —
same `java-21` template, both publishing fine. Two things made the credential
block the real culprit, not just a difference: `"${prop}"` fails hard on a
missing property while `findProperty('prop')` (used by the two publishable libs,
and only for *publishing* to `maven-releases`) returns null; and an
unauthenticated `curl -sI` against `maven-public` returned 200. Sweep the whole
workspace for who reads the credential property before concluding — it was
exactly one build.

**`jacocoCoverageExclusions` does not reach Sonar — this was 235 of the 238
uncovered lines.** The service excluded 9 Spring `@Configuration`/WebClient classes
from its JaCoCo report (and its 90% CI gate) and documented that as policy. Sonar
still counted every one of their lines as uncovered, because a class missing from
the XML is simply "no coverage data", not "excluded". Compare Sonar's
`lines_to_cover` against the JaCoCo total before planning anything: 1949 vs 1714
here, and the difference was exactly those classes. The team's own precedent
(catalog-service, product-service) was to *test* config classes — plain unit
tests, no Spring context, `ReflectionTestUtils` for `@Value` fields — not to
mirror the list into `sonar.coverage.exclusions` (only payment-service does that).
31 such tests took Sonar coverage from 88.0% to 97.8% on their own, and some
assert things worth protecting: the price-v2 listener's disabled auto-commit and
`MANUAL_IMMEDIATE` ack mode, the marketplace client's `/marketplace-product-service/v1`
path prefix (verified against a local reactor-netty server, not by inspecting the
builder). Removing the classes from the JaCoCo exclusion list afterwards keeps the
CI gate and Sonar measuring the same set.

**Two sonar.sh traps, both producing a green-looking run with useless numbers:**
- The sibling scripts' standalone-scanner route (`docker run sonar-scanner-cli`,
  `-Dsonar.sources=/usr/src`) run from Git Bash published a project reading "The
  main branch of this project is empty": MSYS rewrote `/usr/src` into a Windows
  path. assinatura-job's Gradle-plugin script has no such problem and also picks
  up the JaCoCo path from `build.gradle`; it's the one to copy.
- A **relative** `sonar.coverage.jacoco.xmlReportPaths` on a multi-module root
  is resolved against *each* submodule's own directory. Log shows `No coverage
  report can be found` once per submodule plus hundreds of `File 'X.java' not
  found in project sources`, and Sonar reports 0.0%. Use `"${rootDir}/build/..."`.
- Also: a copied script with a hard-coded fallback key publishes whatever service
  it runs in *under the original service's key* — the local sku-data-service
  project briefly showed search-retail's numbers (5521 lines, 32.2% duplication).
  The fallback key is a convenience; set it per service when copying.

**Reliability C came from two issues, both fixable with provably identical
behavior:** `maxAttempts - 1` int subtraction passed to a `long` parameter
(`- 1L`), and `ChronoUnit.DAYS.between(LocalDate, LocalDateTime) > 0` flagged
for "duration on a non-zone-aware type" — rewritten as
`toLocalDate().isBefore(now.toLocalDate())`, which is exactly what `DAYS.between`
computes after converting its second argument, *not* the `ZonedDateTime` rewrite
the rule literally suggests (that one would introduce a timezone conversion where
the semantics are calendar-day). Both changes were shown to the user as
production changes and applied only after an explicit "pode arrumar as duas".

**Parser gotcha:** `parse-jacoco-coverage.js`'s `MapperImpl` suffix filter missed
this service's MapStruct classes (`SkuDataMapperV1Impl`, `SkuSearchMapperV2Impl`).
Now a `/Mapper\w*Impl$/` regex. Also noticed, not touched: `WebClientBuilder` is
never instantiated anywhere in `src/main` (dead code still counted by Sonar), and
`SkuRepositoryImplV2` converts `lastUpdate` with `ZoneId.systemDefault()` while the
rest of the service pins `America/Sao_Paulo`.

**Step 6 via commit boundary worked as assinatura-job's entry promised:** the
coverage work landed as 9 granular commits, and one loop over
`git diff-tree -- '*/src/main/*'` showed exactly one commit touching production
code — the two user-approved Reliability fixes. Before the commits existed, a
`touch`ed marker file in the scratchpad (created after the approved fixes, before
the first test) gave the same check via `find -newer`.
