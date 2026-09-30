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

## 2026-08 — product-service, QA validation round (post-merge)

Third pass on the same service/migration: QA validated the merged US
end-to-end and filed 10 bug reports in about 36 hours, all one root cause
— `@Table("PRODUCT.X")` rendered as a single quoted identifier instead of
schema-qualified access (Spring Data Relational 4.x). This is the sweep
that produced the "audit every data-access method by mechanism" bullet
and the Overview's "other direction" addition above; the raw findings
live here.

- **The bug's actual origin predates its own bug report by a day, and was
  found validating a completely different service.** QA needed this
  service's `PUT /v1/skus/{id}` as an end-to-end proof for an unrelated
  migration (a cache-pipeline service, separately going through the same
  Java/Boot/Gradle jump) and discovered the endpoint itself was down —
  filed as its own bug against this service, one day before the sweep
  that found the other nine. Exactly the "other direction" case: a
  dependency's migration can get validated as a side effect of validating
  something that merely calls it.
- **Ten reports, one root cause, split by CRUD verb, not by feature.** Once
  the schema-qualification defect was known, QA didn't stop at the first
  broken entity — it swept every repository and categorized each method
  by mechanism (hand-written SQL/`@Query` vs. derived query vs.
  `R2dbcEntityTemplate` bound to the entity class), then filed one bug per
  affected resource. The same repository routinely had a healthy read path
  and a broken write path side by side — one resource's `GET` endpoints
  passed while its `PUT` failed, because the reads used hand-written SQL
  and the write used the entity-bound template. Only one resource in the
  whole sweep broke on `DELETE` specifically (create and read both fine,
  delete alone routed through the entity template) — the asymmetry (can
  create, can't remove) was judged worse than an outright outage because
  the API silently accumulates data nothing can retract.
- **A claimed regression that didn't reproduce, and the reasoning that
  proved it.** A teammate reported Jackson 3 rejecting `1`/`0` for a
  `boolean` field, a real and known Jackson 2→3 default change. Reproducing
  with the exact reported payload gave a `500 bad SQL grammar` — the *other*
  bug already found — not the `400` a deserialization rejection would
  produce. That distinction (which failure signature actually came back)
  is what proved the two bugs were independent rather than the same one
  wearing two descriptions: `true`/`false` failed identically to `1`/`0`,
  so the boolean-coercion claim, however plausible, wasn't what was
  actually happening on this build. Filed as its own card with three
  named untested hypotheses (build without Jackson 3 yet, primitive vs.
  wrapper `Boolean` divergence, a different endpoint or service in the
  same release) instead of either dismissing the report or fixing a
  symptom that couldn't be observed. This is the concrete case behind the
  "verify the failure signature matches the claimed mechanism" addition
  above.
- **A bug found during migration validation isn't automatically the
  migration's to own.** The schema-qualification defect masked a second,
  unrelated, pre-existing bug: five routes returned success instead of 404
  for a nonexistent resource (worst case: creating a product referencing a
  SKU that doesn't exist, with no delete route to undo it) — invisible
  until the 500s that had been firing first got fixed. QA deliberately
  filed it as its own card rather than folding it into the migration's own
  validation card, reasoning explicitly that mixing the two would make the
  migration's sign-off look incomplete when it wasn't — the missing-404
  bug predates the migration and survives it unchanged. Matches this
  skill's "Not Everything Flagged Is Migration-Caused," extended to how
  it's *tracked*, not just how it's diagnosed.
- **A forward note for whoever fixes that missing-404 bug, worth carrying
  into any "add a missing validation" fix in general:** the QA plan for it
  explicitly gates the fix on two regression classes beyond "now returns
  404" — the success path for a *real* resource must return byte-identical
  output to before the fix, and a batch/list endpoint must not turn the new
  existence check into one query per item ("the lazy way to fix this is
  validating inside the loop — in a batch of 100 that's 100 queries").
  Fixing a missing check is itself exactly the kind of change likely to
  regress the success path or its own performance, precisely because
  nothing exercised that code path before.
- **The missing-404 bug's own closing note bundled three more fixes —
  reported here at the confidence they actually have, which is lower than
  "closed" suggests.** The bug's own issue was closed with a note claiming
  three unrelated fixes landed in the same pass: a Redis transport-selection
  bug (inverted OS check — `EPOLL` for "anything that isn't macOS," which
  wrongly included Windows, instead of specifically Linux); a
  `MessageSource`/locale bug (error messages ignored `Accept-Language` and
  fell back to the OS's own default locale whenever no message file existed
  for the requested language); and a Liquibase Gradle plugin version too old
  for the Gradle wrapper this same migration bumped, which broke IntelliJ's
  own Gradle sync ("Unable to warm-up Gradle task model") while every CLI
  and CI build stayed green throughout — the concrete case behind the new
  IDE-only-sync-breakage Silent Failures entry above. **None of the three
  has independent verification yet**: the paired QA card for this same bug
  was still open, every one of its scenarios still blocked or unexecuted,
  at the time this entry was written. Logged now as claimed-but-unconfirmed,
  specifically to model the discipline the new Forbidden-section note above
  asks for — a closed dev issue is the author's own report, not a
  verification.

## 2026-09 — assinatura-job

Java 11→25, Spring Boot 2.1.x→4.0.x, Spring Cloud Greenwich.RC2→2025.1.1, Gradle
wrapper 4.10.3→9.5.1, on a pure scheduled job (no controllers anywhere) that reads
Oracle through annotation-only MyBatis and calls REST APIs via RestTemplate. A
sibling service in the same org had made the identical jump weeks earlier, and
checking its migration commits first was worth more than any other single step —
it supplied the exact Boot/Cloud pairing, the ojdbc and MyBatis coordinates, and
the answer to "does the MyBatis bump need source changes" (it does not).

**Ordering is forced and not obvious: Gradle first, on the OLD JDK.** Gradle
4.10.3 cannot drive javac on JDK 25 at all (it boots, resolves dependencies, then
dies with `ExceptionInInitializerError` in compilation), and the Boot 4 plugin
needs Gradle 9. So the only viable sequence was wrapper→9.5.1 while still on JDK
11, then Boot 4, then the toolchain. Getting a *green pre-migration baseline* also
required installing the old JDK specifically for that purpose — worth doing:
207 tests green before, 207 green after, which made every later failure
unambiguously new.

**Only two source breakages in 195 main files**, both trivially found by the
compiler: `RestTemplateBuilder` moved from `org.springframework.boot.web.client`
to `org.springframework.boot.restclient` (confirmed by unzipping the new
`spring-boot-restclient` jar rather than guessing), and
`HttpClientErrorException.getStatusCode()` now returns `HttpStatusCode`, which only
mattered where the value was passed to a typed parameter — the dozen
`HttpStatus.X.equals(getStatusCode())` call sites compiled untouched.

**The real find was a runtime bug that compiles fine and that only a test caught:
Gson reflecting over `java.time`.** Gson serialises unknown types by reflecting
over private fields; the JDK has refused that for `java.base` types since 17,
where Java 11 only printed a warning. Every `new Gson().toJson(x)` on an object
graph containing a `LocalDateTime` therefore threw `JsonIOException` on Java 25.
All three call sites in this service were **log statements inside no try/catch**,
so a logging line aborted the delivery lookup it was only meant to describe. Two
generalisations worth carrying: (1) a reflection-based serializer used anywhere —
even only for logging — is a JDK-version landmine distinct from the framework
bump; (2) check the whole object graph, not the one type a failing test happened
to exercise. Fixed with a shared Gson carrying explicit `java.time` adapters plus
a never-throwing wrapper, since a log line should never be able to kill the
operation. No contract risk here because the wire format is Jackson via
RestTemplate and Gson was log-only — a distinction worth establishing explicitly
before "fixing" a serializer, since changing the wrong one is a contract change.

**A Jackson-related non-event, per the previous entry's warning:** this service
pinned `jackson-annotations:2.9.8`. The pin was dropped and the annotations were
deliberately *not* migrated — `jackson-databind`/`core` move to `tools.jackson.*`
but `jackson-annotations` stays on the 2.x line in its old package. The earlier
product-service entry flagged over-correcting here as a real mistake; reading that
first is what prevented repeating it across 58 `@JsonInclude` usages.

**Two Gradle 9 strictness failures unrelated to Spring**, both worth expecting:
`junit-platform-launcher` must now be an explicit `testRuntimeOnly` dependency or
every test task dies before running a single test; and an aggregate JacocoReport
whose `executionData` fileTree spans the whole rootDir must declare the root
project's own test task as a dependency, not just the subprojects' — that one only
surfaced when the `sonar` task pulled root compilation into the same graph.

**Silent-failure check that mattered most here and cost nothing:** this repo kept
all of its configuration (config-server URI and the whole Vault block) in
`bootstrap*.yml` and did not declare `spring-cloud-starter-bootstrap`. Since
Spring Cloud 2020 the bootstrap context is opt-in, so those files would have been
ignored **with no error at all** and the job would have started with no config and
no secrets. Nothing in a build or test run would have revealed it. Same category
as the removed `spring.factories` mechanism in the previous entry: ask what
*stops happening quietly*, not just what fails to compile.
