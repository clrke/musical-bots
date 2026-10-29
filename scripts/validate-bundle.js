// Validates an episode bundle against director/protocol.md, including the
// mechanical lyric rules. Usage: node scripts/validate-bundle.js [bundle-dir]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plainLyric } from "../web/src/cues.js";
import { resolveAction } from "../web/src/actions.js";
import { NAMES } from "../web/src/gen/cast.js";

const dir = process.argv[2] ?? "episodes/sample";
const errors = [];
const fail = (msg) => errors.push(msg);

const beats = JSON.parse(readFileSync(join(dir, "beats.json"), "utf8"));
if (typeof beats.prompt !== "string" || !beats.prompt) fail("beats.json: prompt must be a non-empty string");
if (typeof beats.seed !== "string" || !beats.seed) fail("beats.json: seed must be a non-empty string");
if (!Array.isArray(beats.beats) || beats.beats.length === 0) fail("beats.json: beats must be a non-empty array");
const beatIds = new Set((beats.beats ?? []).map((b) => b.id));
// v2 (all optional): roles, tags, beats[].set
const NAME_SET = new Set(NAMES);
const SETS = new Set(["studio", "diner", "big_house", "street"]);
const STRICT = beats.version === 2; // v2 bundles: every action must be in web/src/actions.js
if (beats.roles !== undefined) {
  for (const [k, v] of Object.entries(beats.roles)) if (!NAME_SET.has(v)) fail(`beats.json: roles.${k} ${JSON.stringify(v)} is not a cast name`);
}
for (const b of beats.beats ?? []) if (b.set !== undefined && !SETS.has(b.set)) fail(`beats.json: ${b.id} has unknown set ${JSON.stringify(b.set)}`);

const STATUSES = new Set(["working", "proposing", "done", "consulting"]);
const BANNED = /\b(we|us|our|all)\b/i;
const FUTURE = /\bwill\b|\bgoing to\b/i;

const lines = readFileSync(join(dir, "events.ndjson"), "utf8").split("\n").filter((l) => l.trim());
let prevT = -Infinity;
let dyes = 0;
lines.forEach((line, i) => {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    fail(`line ${i}: not valid JSON`);
    return;
  }
  if (e.seq !== i) fail(`line ${i}: seq must be ${i}, got ${e.seq}`);
  if (typeof e.t !== "number" || e.t < 0 || e.t < prevT) fail(`line ${i}: t must be non-decreasing >= 0`);
  prevT = e.t;
  for (const f of ["agent", "bot", "beat", "summary"]) {
    if (typeof e[f] !== "string" || !e[f]) fail(`line ${i}: ${f} must be a non-empty string`);
  }
  for (const f of ["lyric", "action"]) {
    if (typeof e[f] !== "string") fail(`line ${i}: ${f} must be a string`);
  }
  if (!STATUSES.has(e.status)) fail(`line ${i}: bad status ${JSON.stringify(e.status)}`);
  if (!beatIds.has(e.beat)) fail(`line ${i}: unknown beat ${JSON.stringify(e.beat)}`);
  for (const f of ["chords", "consult"]) {
    if (!Array.isArray(e[f]) || !e[f].every((x) => typeof x === "string")) {
      fail(`line ${i}: ${f} must be an array of strings`);
    }
  }
  for (const f of ["summary", "lyric"]) {
    const text = f === "lyric" ? plainLyric(e[f] ?? "") : e[f] ?? "";
    if (BANNED.test(text)) fail(`line ${i}: ${f} breaks the lyric rule (we/us/our/all)`);
    if (FUTURE.test(text)) fail(`line ${i}: ${f} uses future tense`);
  }
  // v2 (all optional)
  if (e.singer !== undefined && !NAME_SET.has(e.singer)) fail(`line ${i}: singer ${JSON.stringify(e.singer)} is not a cast name`);
  if (e.with !== undefined && (!Array.isArray(e.with) || !e.with.every((n) => NAME_SET.has(n)))) fail(`line ${i}: with must be cast names`);
  const named = [...(e.lyric ?? "").matchAll(/\{([A-Za-z][A-Za-z-]*)/g)].map((m) => m[1]);
  const unknown = named.filter((n) => !NAMES.some((x) => x.toLowerCase() === n.toLowerCase()));
  if (unknown.length) fail(`line ${i}: lyric names unknown bot(s) ${unknown.join(", ")}`);
  if (STRICT && e.action && resolveAction(e.action).kind === "none") fail(`line ${i}: unknown action ${JSON.stringify(e.action)}`);
  if (e.dye === true) dyes++;
});

if (errors.length > 0) {
  console.error(`INVALID ${dir}: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`OK ${dir}: ${beats.beats.length} beat(s), ${lines.length} event(s)${dyes ? `, ${dyes} dye marker(s)` : ""}`);
