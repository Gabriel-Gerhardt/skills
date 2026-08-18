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
