// Validates an episode bundle against director/protocol.md, including the
// mechanical lyric rules. Usage: node scripts/validate-bundle.js [bundle-dir]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { plainLyric } from "../web/src/cues.js";
import { resolveAction } from "../web/src/actions.js";
import { NAMES } from "../web/src/gen/cast.js";
import { modernBundle } from "../web/src/cast16.js";
import { activityProblems, ACTIVITY_FILE } from "./director/activity.js";

const dir = process.argv[2] ?? "episodes/sample";
const errors = [];
const fail = (msg) => errors.push(msg);

// a bundle directed before the cast took its colour names is read in them (cast16.js modernBundle)
const beats = modernBundle(JSON.parse(readFileSync(join(dir, "beats.json"), "utf8")));
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
// the director's additions (all optional): the checked facts, the summaries' form
if (beats.facts !== undefined && (!Array.isArray(beats.facts) || !beats.facts.every((f) => typeof f === "string" && f.trim()))) fail("beats.json: facts must be an array of non-empty strings");
if (beats.summaries !== undefined && !["talk", "we", "first-person"].includes(beats.summaries)) fail(`beats.json: summaries ${JSON.stringify(beats.summaries)} (only "talk"; "we" before Oct 31, "first-person" before Oct 30)`);
const CHECKS = new Set(["dictionary", "rhyme", "meter", "balance", "filler", "inversion", "repeat"]); // scripts/director/craft.js
const consults = new Map(); // seq -> the consulting event (for `answers`)
const answered = new Set();

const STATUSES = new Set(["working", "proposing", "done", "consulting"]);
const FUTURE = /\bwill\b|\bgoing to\b/i;

const lines = readFileSync(join(dir, "events.ndjson"), "utf8").split("\n").filter((l) => l.trim());
let prevT = -Infinity;
let dyes = 0;
lines.forEach((line, i) => {
  let e;
  try {
    e = modernBundle(JSON.parse(line));
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
  // the director's additions (all optional): the answer to a consultation, the craft checks bypassed
  if (e.answers !== undefined) {
    const q = consults.get(e.answers);
    if (!Number.isInteger(e.answers) || !q || !q.consult.includes(e.bot) || q.bot === e.bot) fail(`line ${i}: answers ${JSON.stringify(e.answers)} is no earlier consultation naming ${e.bot}`);
    else if (answered.has(`${e.answers}:${e.bot}`)) fail(`line ${i}: ${e.bot} answers consultation ${e.answers} twice`);
    answered.add(`${e.answers}:${e.bot}`);
  }
  if (e.bypassed !== undefined && (!Array.isArray(e.bypassed) || !e.bypassed.every((b) => b && CHECKS.has(b.check) && typeof b.reason === "string" && b.reason.trim().split(/\s+/).length >= 4
    && (b.words === undefined || (Array.isArray(b.words) && b.words.every((w) => typeof w === "string")))))) {
    fail(`line ${i}: bypassed must be [{ check: ${[...CHECKS].join("|")}, reason: at least 4 words }]`);
  }
  if (e.status === "consulting" && Array.isArray(e.consult) && e.consult.length) consults.set(e.seq, e);
});

// the production's activity log (optional; scripts/director/activity.js): what the director and the crew did, when
let activity = 0;
if (existsSync(join(dir, ACTIVITY_FILE))) {
  const list = [];
  readFileSync(join(dir, ACTIVITY_FILE), "utf8").split("\n").filter((l) => l.trim()).forEach((l, i) => {
    try { list.push(JSON.parse(l)); } catch { fail(`${ACTIVITY_FILE} line ${i}: not valid JSON`); }
  });
  const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const p of activityProblems(list, { events })) fail(`${ACTIVITY_FILE}: ${p}`);
  activity = list.length;
}

if (errors.length > 0) {
  console.error(`INVALID ${dir}: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`OK ${dir}: ${beats.beats.length} beat(s), ${lines.length} event(s)${dyes ? `, ${dyes} dye marker(s)` : ""}${activity ? `, ${activity} activity entries` : ""}`);
