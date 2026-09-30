#!/usr/bin/env node
// Streaming JaCoCo XML parser — per-class LINE coverage, generated-code-aware.
//
// Why not a naive `<class name="X">...</class>` regex pair: two real bugs found
// the hard way while building this on a real ~200-class multi-module project.
//
// Bug 1 — self-closing classes steal the next class's data.
//   A pure marker interface (e.g. `interface Foo extends JpaRepository<X,Y> {}`
//   with zero custom methods) has NO instrumentable bytecode, so JaCoCo emits
//   it as `<class name="Foo" sourcefilename="Foo.java"/>` — self-closing, no
//   `</class>`. A regex built as `<class name="([^"]+)"[^>]*>([\s\S]*?)<\/class>`
//   still matches the self-closing tag's `.../` as if it were an opening tag
//   (since `[^>]*` happily consumes the trailing `/`), then lazily captures
//   everything up to the *next* class's `</class>` as "Foo"'s body — silently
//   attributing an unrelated sibling class's entire coverage data to Foo, and
//   shifting every class after it in the same package by one position. This
//   only shows up as a class with an "impossible" missed-line count (e.g. a
//   14-line interface reported as 96% of the whole package's coverage gap).
//
// Bug 2 — the first LINE counter inside a class is a *method's*, not the
//   class's own aggregate. JaCoCo's `<class>` element lists each `<method>`
//   (with its own LINE/BRANCH/etc. counters) first, then the class-level
//   aggregate counters *last*, as direct children after all methods close.
//   Grabbing the first `<counter type="LINE">` match inside the class body
//   silently returns one method's count instead of the whole class's.
//
// Both are avoided here by a real tag-by-tag scan with an explicit "am I
// inside a <method>?" flag, rather than any single regex spanning tag pairs.
//
// Also filters out generated code (protobuf/avro/MapStruct `*Impl`), which
// JaCoCo instruments and reports on but Sonar does NOT count in "lines to
// cover" — that generated source lives under build/generated/... which is
// outside the default `sonar.sources` (src/main/java), so Sonar's own
// component tree simply never sees those classes. Leaving them in makes the
// numbers wildly pessimistic (a huge generated class at 0% dominates the
// denominator) and disagree with what the actual Sonar quality gate shows.
// Extend the filter for your project's own generated-code packages/suffixes.
//
// Usage: node parse-jacoco-coverage.js path/to/jacocoTestReport.xml [--all]
//   --all   also print classes already at 100% (default: only classes with
//           missed > 0, sorted worst-first, for triaging where to focus)

const fs = require('fs');

const xmlPath = process.argv[2];
const showAll = process.argv.includes('--all');
if (!xmlPath) {
  console.error('Usage: node parse-jacoco-coverage.js path/to/jacocoTestReport.xml [--all]');
  process.exit(1);
}
const xml = fs.readFileSync(xmlPath, 'utf8');

// Adjust to your own project's generated-code layout.
const GENERATED_PREFIXES = ['/proto/', '/avro/'];
// MapStruct names its implementation <MapperInterface>Impl, so a versioned mapper
// (SkuDataMapperV1 -> SkuDataMapperV1Impl) doesn't end in "MapperImpl".
const GENERATED_SUFFIXES = [/Mapper\w*Impl$/];

const tagRe = /<(\/?)([a-zA-Z0-9_]+)((?:\s+[a-zA-Z0-9:_-]+="[^"]*")*)\s*(\/?)>/g;
const attrRe = /([a-zA-Z0-9:_-]+)="([^"]*)"/g;

function parseAttrs(attrStr) {
  const attrs = {};
  let m;
  attrRe.lastIndex = 0;
  while ((m = attrRe.exec(attrStr)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

let results = [];
let curClass = null;
let inMethod = false;

let m;
while ((m = tagRe.exec(xml)) !== null) {
  const closing = m[1] === '/';
  const tag = m[2];
  const selfClosing = m[4] === '/';
  const attrs = parseAttrs(m[3]);

  if (tag === 'class') {
    if (closing) {
      if (curClass) results.push(curClass);
      curClass = null;
    } else {
      curClass = { name: attrs.name, missed: null, covered: null };
      if (selfClosing) {
        // Zero instrumented content (e.g. a pure marker interface) — record
        // as 0/0 and close immediately. Do NOT let the scan continue to
        // treat this as an open tag (that's Bug 1 above).
        results.push(curClass);
        curClass = null;
      }
    }
    continue;
  }

  if (tag === 'method') {
    if (!closing && !selfClosing) inMethod = true;
    if (closing) inMethod = false;
    continue;
  }

  if (tag === 'counter' && curClass && !inMethod && attrs.type === 'LINE') {
    // Only take LINE counters that are direct children of <class>, i.e. not
    // inside a <method> — that's the class-level aggregate (Bug 2 above).
    curClass.missed = parseInt(attrs.missed, 10);
    curClass.covered = parseInt(attrs.covered, 10);
  }
}

results = results.filter(r => r.missed !== null && r.covered !== null);
results = results.filter(r =>
  !GENERATED_PREFIXES.some(p => r.name.includes(p)) &&
  !GENERATED_SUFFIXES.some(re => re.test(r.name))
);
results = results
  .map(r => ({ ...r, total: r.missed + r.covered }))
  .filter(r => r.total > 0)
  .map(r => ({ ...r, pct: +(r.covered / r.total * 100).toFixed(1) }));

results.sort((a, b) => b.missed - a.missed);

const totalMissed = results.reduce((s, r) => s + r.missed, 0);
const totalCovered = results.reduce((s, r) => s + r.covered, 0);
const totalLines = totalMissed + totalCovered;

console.log(`TOTAL: ${totalCovered}/${totalLines} covered (${(totalCovered / totalLines * 100).toFixed(2)}%), ${totalMissed} missed`);
console.log(`Classes with coverage data: ${results.length}`);
console.log('---');

for (const r of results) {
  if (!showAll && r.missed === 0) continue;
  console.log(`${r.missed}\t${r.covered}\t${r.total}\t${r.pct}%\t${r.name}`);
}
