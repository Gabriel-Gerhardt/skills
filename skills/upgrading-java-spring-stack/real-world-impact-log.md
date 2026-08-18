# Real-World Impact Log — upgrading-java-spring-stack

Append-only. One dated entry per service this skill has been used on. See
`raising-sonar-quality-score`'s log for the format/rationale — same
convention, applied here. Note version *families* (2.x→4.x, not exact
patch numbers) — the breaking changes below are tied to major-version
boundaries, not the specific patch either side happened to land on; a
future 2.5.x→4.1.x jump hits the same ones for the same reasons. Don't edit
a previous entry except to fix an error in it.

## 2026-08 — product-service

Java (two LTS releases forward, staged rather than a direct jump) / Spring
Boot 2.x→4.x (via an intermediate 3.x step) / Gradle wrapper 7.x→9.x. Spring
Cloud re-paired to match the new Spring Boot major version via its own
compatibility matrix, not left at its old pinned version.

Real breaking changes hit, for reference (not exhaustive — each Boot major
version has its own list, check its actual migration guide):

- **Jackson 2.x→3.x**: groupId changed (`com.fasterxml.jackson.core` →
  `tools.jackson.core` for databind/core), packages moved to
  `tools.jackson.databind.*`; `jackson-annotations` stayed on the 2.x line
  and its old package, unchanged — easy to over-correct and break that one
  too by assuming everything Jackson-named moved together.
- **Spring Boot 4.x removed `spring.factories`-based auto-configuration
  entirely** — this is the Silent Failures example in this skill's main
  body. A third-party library that registered its exception handler that
  way stopped firing silently: no compile error, no test failure, just a
  handler that never runs in the real app. Fixed by explicitly
  `@Bean`-registering the library's own configuration class.
- **Spring Data 4.x**: `ReactiveSortingRepository<T,ID>` lost its inherited
  CRUD methods (now extends only the bare marker interface); repositories
  needing both had to switch to `R2dbcRepository<T,ID>` explicitly.
- **`@MockBean` (Spring Boot) removed** → `@MockitoBean` (plain
  `spring-test`, not a Spring Boot artifact).
- **`@WebFluxTest` moved to its own module/package**, needing an explicit
  test-scope dependency that wasn't required before.
- **`WebTestClient.BodyContentSpec.jsonPath(String, Object...)`** — the
  varargs format-string overload was removed; only `jsonPath(String)`
  remains.
- **Picking which major-version *family* of a third-party library
  preserves an existing API contract mattered more than picking the
  "newest" version** — one dependency had two unrelated major-version
  families (confusingly, both still actively released) with genuinely
  different response shapes under the hood; a sibling service in the same
  org turned out to be the real precedent for which family to use, not
  the library's own version-number recency.

No contract changes resulted from any of the above — each was a
call-site/registration fix, not a behavior change, verified the same way
`raising-sonar-quality-score`'s step 6 verifies test-only passes.

## 2026-08 — product-service, MR review round (same migration)

Follow-up pass on the same service/migration as the entry above: a
reviewer went through the actual merge request thread by thread, and the
app was run for real rather than trusted from a green build+test — which
is what surfaced the two genuine runtime-only bugs below. Neither showed
up in compilation or in any of the 660+ existing tests.

- **Missing per-technology auto-configuration module.** `spring-kafka`
  (the client) plus Spring Boot itself was not enough post-Boot-4 —
  without the separate Kafka auto-configuration module explicitly on the
  classpath, no `ProducerFactory` bean existed and the app died on
  startup with a dependency-injection error. This is the "one level
  down" case this skill's Silent Failures section now calls out
  explicitly, added as a direct result of finding it here. Independently
  confirmed as a systemic Boot-4 issue, not something specific to this
  codebase: a sibling service in the same org, running the identical
  Java/Boot/Gradle jump around the same time, hit the exact same bug and
  documented the identical fix in its own migration commit/QA issue —
  found by checking whether anyone else had already made this jump
  before assuming the bug was novel (see the Overview's sibling-service
  note, added for the same reason).
- **A transitive dependency collision introduced by swapping a
  like-for-like library.** Replacing the old API-doc tool with a
  Boot-4-compatible successor pulled in a jakarta-namespaced annotations
  jar. An unrelated, untouched dependency (a Kafka schema-registry
  client) already pulled a non-jakarta sibling jar under the exact same
  Java package — one silently shadowed the other on the classpath, and
  the app's own OpenAPI-spec endpoint died at runtime with
  `NoSuchMethodError` for a method that only exists on the newer one.
  Zero test coverage caught it, because no test exercises that specific
  endpoint's serialization path. Fixed with a Gradle `exclude` on the
  older dependency. General lesson: swapping any library for a
  same-purpose replacement can create a *new* collision with an
  existing, otherwise-untouched dependency that happens to share a
  package — worth a `dependencyInsight` check on the replacement's own
  transitive annotation/model jars, not just on the thing being
  replaced.

The serialization-library bump (see the Jackson entry above) had two
further, more specific effects, both found only by testing behavior
directly rather than trusting a changelog:

- `WRITE_DATES_AS_TIMESTAMPS` moved from `SerializationFeature` to a new
  `DateTimeFeature` enum between the 2.x and 3.x lines, and its default
  flipped from `true` to `false` — found by decompiling both
  `jackson-databind` jar versions (`javap -constants`) and confirmed
  empirically by running the same payload through an old-configured and
  a new-configured mapper side by side, not by reading either changelog.
  A logging helper's date output silently changed shape (`[2026,8,13]` →
  `"2026-08-13"`); the flag was re-enabled at its new location and a test
  now asserts the exact byte output so a future default flip fails the
  build instead of shipping quietly.
- The new major line also stopped coercing a numeric literal into a
  `boolean`-typed field on *deserialization* — a real contract-narrowing
  change on request bodies, flagged but deliberately left unfixed
  pending an explicit compatibility decision, not a bug in this
  service's code. No existing test caught it: every one either
  serializes outbound (never touches deserialization coercion at all) or
  deserializes a payload already shaped the new library's way. This is
  exactly the "reverse direction" check this skill's Silent Failures
  section now calls out explicitly, added to this skill as a direct
  result of finding it here.

Also found, and correctly *not* treated as migration bugs (see "Not
Everything Flagged Is Migration-Caused," added to this skill as a direct
result of both of these): a reviewer flagged a newly-added hand-written
`equals()` on an entity as a suspicious identity→value-semantics change,
but it turned out to be the fix for a pre-existing contract violation (a
hand-written `hashCode()`, unrelated to this migration, had been silently
suppressing a Lombok-generated `equals()` that covered different fields)
made during this same engagement's earlier quality-score hardening pass
(see `raising-sonar-quality-score`'s own log for that class's
branch-coverage history) — not something this migration introduced, and
not a new risk at review time either, since the fix had already landed
before the review round started; and a
`LocalDateTime.now(ZoneId.systemDefault())` rewrite of a bare `now()`
call, required by a newly-enforced ErrorProne rule, was flagged by a
reviewer as a possible timezone-behavior change but is provably a no-op —
`now()` is implemented as `now(Clock.systemDefaultZone())` internally, so
both forms already read the exact same zone.

**Environment note specific to this org, unrelated to the migration
itself but load-bearing for finding any of the above**: the app could not
be run natively on the Windows dev machine used for this pass at all — an
unrelated cache-client dependency hardcodes a Linux-only native transport
for any non-macOS host, and no general-purpose WSL distro was available
either. Running the built jar inside a Linux container was what unlocked
finding the two runtime-only bugs above; a build+test-only verification
pass on this platform would have shipped both. Worth checking whether the
dev machine can actually run the app at all, upfront, before concluding a
green build+test means the app itself works.
