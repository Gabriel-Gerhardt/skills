---
name: upgrading-java-spring-stack
description: Use when a Java/Spring Boot service needs its core runtime stack bumped — Java LTS version, a Spring Boot major-version jump, Spring Cloud BOM pairing, the Gradle wrapper, or core libraries (Jackson, MapStruct, Lombok) that move in lockstep with a framework major version. Technology-specific: Java + Spring Boot + Gradle.
---

# Upgrading the Java/Spring Stack

## Overview

A checklist of *what* to check before/during a Java LTS or Spring Boot
major-version bump — not a catalogue of every specific breaking change.
Framework major versions break things in ways the framework itself
documents exhaustively (release notes, migration guides) and that change
between releases; pre-cataloguing every gotcha here would go stale the
moment a new release ships, and give false confidence for whatever breaks
next that isn't on the list. Discover most problems by compiling and
running the test suite after each bump — that's cheap and it works for
anything that fails loudly. It also pays to check whether a sibling
service in the same org has already made the identical jump — its
migration commit, MR thread, or QA issue is often the fastest way to find
a real gotcha before hitting it yourself, and independent convergence on
the same bug across two unrelated codebases is strong evidence it's a
framework-level issue rather than something specific to yours. This runs
in the other direction too: validating a *different* service's migration
can surface a bug in a service it merely depends on for an end-to-end
check, one nobody set out to test. Treat that as a real finding worth its
own report against the dependency, not just an obstacle to route around
in the service you were actually validating.

**The one thing that discovery-by-building can't catch: silent behavior
changes.** Not everything that breaks fails to compile or fails a test —
some things just quietly stop happening, with no error anywhere. See
Silent Failures below; it's the one category worth a dedicated section
instead of trusting the build to surface it.

**Sibling skill**: once the stack itself is upgraded,
`raising-sonar-quality-score` covers the *quality-tooling* layer
(Checkstyle, JaCoCo, OWASP dependency-check, Sonar) — deliberately out of
scope here.

## What to Check

Bump one at a time, rebuild, run the full test suite, before moving to the
next — don't batch several major bumps into one untested step. Confirm
existing tests are green *before* touching anything, same reason as
`raising-sonar-quality-score`'s step 1: so a later failure is unambiguously
new, not a pre-existing one getting misattributed to this pass.

- **Java LTS version** — check the target's actual current LTS, not the
  one from memory; a new one ships roughly every two years, and it's easy
  to target one that's already one behind. Configure it via a Gradle
  toolchain block (`java { toolchain { languageVersion =
  JavaLanguageVersion.of(N) } } }`), not `sourceCompatibility`/
  `targetCompatibility` — the toolchain form provisions the JDK
  independently of whatever JDK is actually running Gradle; don't mix
  both forms on the same project.
- **Spring Boot major version** — read its own release notes/migration
  guide for the specific jump you're making (e.g. "Spring Boot X to Y
  Migration Guide") before starting, not after something breaks.
- **Auto-configuration granularity for the technologies you use** — a
  Spring Boot major version can split what used to be one monolithic
  auto-configuration artifact into separate per-technology modules (e.g.
  a Kafka-specific one, distinct from both the framework itself and the
  raw client library). Depending on the client library plus the
  framework is not automatically enough; if the matching
  auto-configuration module isn't on the classpath, its beans simply
  don't exist and the app fails at startup with a dependency-injection
  error — not a compile error, and not something any test that mocks or
  slices around that bean will ever catch. Check the new Boot BOM's
  module list for every technology the service actually uses.
- **Spring Cloud** — paired to a specific Spring Boot version by its own
  compatibility matrix, if the service uses it; don't assume the latest
  Spring Cloud release supports the Spring Boot version you just picked.
- **Gradle wrapper** — Spring Boot/Spring Cloud plugins often have a
  minimum (and sometimes maximum) supported Gradle version; check before
  assuming "latest Gradle" is compatible with everything else you're
  bumping in the same pass.
- **Jackson** — versioned and sometimes namespaced independently of Spring
  Boot; check what the new Boot BOM actually pulls in rather than assuming
  it tracks the old major version.
- **MapStruct, Lombok, and their annotation-processor glue** (e.g. a
  lombok-mapstruct-binding artifact) — these need to agree with each other
  and with the new Java version, not just with Spring Boot.
- **ErrorProne / Checkstyle / other static-analysis Gradle plugins** — a
  Gradle major-version bump (which a Spring Boot major bump sometimes
  forces) can break plugins that use now-removed Gradle internals; this is
  where this list and `raising-sonar-quality-score`'s tooling list overlap.
- **Any third-party library your service depends on for cross-cutting
  concerns** (exception handling, tracing, logging) — check whether it
  still supports the framework version you're moving to at all before
  assuming it just needs a version bump; some don't, and the fix is
  choosing a different library or version family, not patching around it.
- **Any dependency version already pinned manually in the build** — a pin
  from before the bump can resolve to something *older* than what the new
  Boot BOM would have chosen on its own, silently reintroducing a bug the
  BOM's own version already fixed. Check with
  `./gradlew <module>:dependencyInsight --dependency <name>` whether
  removing the manual pin and letting the BOM resolve it changes the
  version — and if it does, understand why the pin existed before
  deleting it outright.

- **When an ORM/metadata-driven query-building mechanism changes behavior,
  sweep every data-access method by which mechanism it actually uses, not
  by which entity it belongs to.** A single repository routinely mixes
  hand-written SQL (a `@Query` or a raw `DatabaseClient` call — immune,
  since the framework's metadata never gets involved) with
  framework-generated queries (a derived method, or a template call bound
  to the entity class — exposed). The two can sit in the same file, even
  the same repository, with the read path on one mechanism and the write
  or delete path on the other — so a healthy-looking `GET` proves nothing
  about whether `PUT`/`DELETE`/an event-driven write on the *same* entity
  still works. Audit per method, not per entity, and don't stop at the
  first broken one — the same root cause typically hits every entity using
  the exposed mechanism, each surfacing on a different CRUD verb.

**When a dependency's actual behavior isn't clear from its docs or
changelog** — which constructor signature it still exposes, whether a
config flag moved to a different class, whether two jar versions really
ship the same fields — decompile and diff the two versions directly
(`javap -p -c -constants` on the extracted `.class` files) rather than
trusting release notes, which routinely omit exactly this kind of
mechanical detail.

## Silent Failures

The failure mode discovery-by-building misses: a Spring Boot major version
can remove or change an *auto-configuration* mechanism a third-party
library relies on to register itself — with no compile error and no test
failure, because the library's classes are all still there and still
compile fine. The only symptom is that the library's behavior just doesn't
happen in the running application. A concrete real example: a Boot major
version removing `spring.factories`-based `@EnableAutoConfiguration`
discovery entirely — a library that used the old mechanism to
self-register its exception handler kept compiling and kept passing its
own unit tests, but its handler never fired in the real app, because
nothing was left to discover it. Fixed by explicitly `@Bean`-registering
the library's own configuration class instead of relying on it to
auto-register.

The same silence shows up one level down, too, and it's the framework's
own doing rather than a third-party library's: Spring Boot's
auto-configuration for a specific technology can move into its own module
in the new major version (see the auto-configuration bullet above). Omit
that module and its beans don't exist — same no-compile-error,
no-test-failure signature, because any test that mocks or slices around
that bean never builds the dependency graph that would actually need it.

**When bumping a Spring Boot major version, explicitly check whether any
third-party library your service uses for something not directly exercised
by an integration test (exception handling, tracing/logging bridges,
custom auto-configuration) still gets wired up in a real running instance**
— not just that it compiles and its own tests pass. A quick way: start the
app for real (or the narrowest slice that exercises the behavior) and
confirm the library's effect actually happens, rather than trusting a green
build. If the service depends on a native library tied to a specific OS (a
cache client that only ships a Linux-native transport, say), "start the app
for real" may require a container or VM matching that OS rather than the
dev machine's own — confirm that upfront, so this whole category of
failure doesn't stay invisible simply because nobody could get the app
running far enough to look for it.

**Check the reverse direction too: deserialization leniency, not just
response shape.** A serialization-library major bump can tighten what it
accepts on the way *in* — refusing a loosely-typed value (a number where a
boolean was expected, say) that the old version silently coerced — without
changing a single byte of what your service sends *out*. No test that only
serializes a Java object and asserts on the resulting JSON will ever
exercise this, and neither will one that deserializes JSON already shaped
the way the new library expects. It only shows up when an external caller
sends a request shaped the way the *old* library used to tolerate. Verify
by feeding an endpoint a request body shaped the way real callers already
send it — not a freshly-written one that happens to match the new
library's stricter expectations.

**Check for build-tooling plugins that only break inside an IDE's own
Gradle sync, never in a CLI/CI build.** A schema-migration or other
Gradle-plugin dependency can pin a version that's fine for `./gradlew
build`/`test` on the command line but that an IDE's own Gradle
integration fails to resolve after the wrapper itself moves to a new
major version — the CLI build and CI both stay green throughout, so
nothing in the pipeline ever reports it. The only way to catch this is to
actually open the project in the IDE the team uses and let it sync,
separately from running the build; a fully green CI run is not evidence
this category is fine.

## Not Everything Flagged Is Migration-Caused

A reviewer (or your own reading of a diff) calling something "changed by
this bump" doesn't make it true — verify root cause against the actual
pre-migration commit before either fixing it as a regression or dismissing
it as a false alarm. Two shapes this takes in practice: a bug that already
existed before the bump, merely made more visible by something else in the
same pass (e.g. a newly-enforced static-analysis rule surfacing a
pre-existing contract violation nobody had written a method for yet); and
a change required by a linter/static-analysis rule the bump forces you to
satisfy, which reads like a behavior change in the diff but provably isn't
one — check against the actual JDK/library source semantics, not just the
diff's shape. A third shape: a real failure, correctly observed, attributed
to the wrong one of several plausible migration-related causes — a
teammate can genuinely hit an error on the new version and still name the
wrong mechanism, especially when more than one breaking change landed in
the same pass. Verify by reproducing with a request/input shaped to isolate
exactly the claimed mechanism (e.g. the same body with only the one
disputed field varied), and check that the *failure signature* matches
what that mechanism would actually produce — a rejection during request
parsing and a failure two layers downstream during persistence are not
the same bug, even if the same request triggers both. All three shapes are
real findings worth reporting on their own terms — just not as "this bump
broke X."

## Forbidden

Same as `raising-sonar-quality-score`'s Forbidden section — no API contract
changes, no unflagged production tweaks "to make something work," no
self-reported "nothing changed." Verify per that skill's step 6 technique
even for a framework bump, especially around exception handling, response
serialization, and request-deserialization leniency (the two are not the
same check — see Silent Failures above) — exactly the areas a framework
major version likes to change defaults on quietly.

**A bug-tracker issue marked "closed" is itself a self-report, not
independent verification.** When a fix has its own separate QA/validation
card (as opposed to the same person's own tests in the same issue), check
that card's actual status before treating the fix as confirmed — a dev
issue can close the moment its author believes the fix works, while the
paired QA card sits open with every scenario still blocked or unexecuted.
Report or document a fix at the confidence its actual verification
supports, not at the confidence its author's issue-closing note implies.

## Real-World Impact Log

See [`real-world-impact-log.md`](real-world-impact-log.md) — same
append-only convention as `raising-sonar-quality-score`'s log, kept
separate for the same reason (this skill's own body stays a checklist, not
a growing gotcha catalogue). Add a new dated entry every time this skill is
used, not just the first.
