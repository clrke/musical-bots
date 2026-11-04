#!/usr/bin/env node
// The AI director: Muse Code (Meta's agentic coding CLI, headless) directs one episode with a crew of
// eight role subagents, each its own Muse agent definition with its own prompt (director/prompts):
// Green/lyrics, White/chords, Gray/dance, Blue/lighting, Gold/deals, Yellow/hype, Pink/comedy, Black/trouble
// (the plot's trouble: the problems that make the story interesting, web/src/plot-trouble.js).
//
//   node scripts/director/direct.js "<prompt>" [--slug x] [--out dir] [--live]
//   node scripts/director/direct.js --all [--out episodes]      the 14 curated seeds (web/src/curated.js)
//     [--only slug,slug | --skip slug,slug]                       a part of them
//   npm run direct -- "<prompt>" ...                            (the same)
// Options: --effort low|medium|high (the crew; default low), --lyrics-effort <e> and --director-effort <e>
//   (Green's lines and the plan; default: high, or --effort when it is higher),
//   --model <id> (default: Muse's own default), --provider meta|echo, --muse <bin> ($MUSE_BIN,
//   default ~/.local/bin/muse), --timeout <s> (1500: one Muse run's limit), --repairs <n> (3, as the budget allows),
//   --budget <s> (the whole run's time: every Muse run gets what is left, the crew stops in time for the lyric pass),
//   --stall <s> (300: the whole crew silent: no call, no event, no Muse activity), --progress <s> (540: the crew busy
//   but no call accepted: stopped, and the next run gets its refusals), --settle <s> (75),
//   --crew workflow|processes (who runs the crew: the director's Muse Workflow, or this host, each agent its own
//   session; default: processes where the Workflow would seat fewer than eight, workflowCap; $MB_CREW),
//   --resume (with --live: go on with the bundle already in --out, a hosted run that died), --keep (keep .director/),
//   --no-web (no web_search / web_fetch: by default the director researches a real-world premise),
//   --no-repo (no read-only access to this repo and its git history: by default the director and the
//   crew may read it, $MB_REPO, so a premise about the project is told from its real commits),
//   --brief <file> (the premise's fact sheet; default director/briefs/<slug>.md when it exists),
//   --craft strict|warn|off (the craft checks, craft.js: strict rejects a weak line unless the agent
//   bypasses it with a reason, the default; warn only notes; off skips them),
//   --no-wonder (skip the lyric pass: by default, once the gate passes, Meta's Muse Wonder writes the sung lyrics from the
//   crew's drafts, wonder-lyrics.js; it needs META_API_KEY and costs about $0.2 an episode; $MB_NO_WONDER=1 does the same),
//   --no-muse-sandbox (Muse's own shell sandbox off, for a host that is the sandbox: the hosted runner's Vercel Sandbox),
//   --dry-run (write the prompts and the agent overlay, run nothing).
//
// How a run goes:
//   1. The bundle's scratch (.director/) gets the clock (t0), a one-line emit command and the
//      rendered prompts; the vocabulary comes from actions.js, cues.js, form.js and cast.js at run
//      time, so the prompts never drift from the stage.
//   2. `muse exec` runs the director prompt with the crew as an --agents overlay. The director plans
//      beats.json (emit.js --beats), then launches the Workflow scripts/director/workflow.js, which
//      starts the eight agents at once; they append their events through emit.js (validated, in beat
//      order, `t` = real seconds) while the LIVE page polls the bundle. (--crew processes, a small host such as
//      the hosted runner's sandbox: the director only plans, then this script starts the eight crew sessions itself.)
//   3. The gate (emit.js checkBundle: validate-bundle.js, the stanza form, the consultations, all
//      eight roles, Black's plot trouble) decides; a failed gate gets repair runs while the budget lasts (the crew
//      resumes at the open beat). A watchdog stops a crew that is silent, or busy without progress (watch).
//   4. director.json records the provenance: Muse version, model, effort, wall time, tokens (the
//      director and every subagent, from Muse's session logs) and an estimated cost, per-role counts,
//      and the craft checks (the mode, every bypass and its reason, the counts per check).
//   5. activity.ndjson records what the director and the crew really did, when (activity.js: their
//      tool calls from Muse's session logs, every gate call from emit.js's log, sanitized): the
//      making-of sings it in its waits, and each queued thought from when it was written.
// Without --live the run works in a temp dir and replaces <out> only when the gate passes.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, chmodSync, readdirSync, copyFileSync, renameSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, homedir, availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initState, rebuildState, readState, readBeats, readEvents, checkBundle, finalize, slugify, MAX_SUMMARY_SYLLABLES, MIN_EXCHANGES } from './emit.js';
import { MAX_MOVE_SYLLABLES, MIN_ASKED, MIN_CONSULTATIONS } from '../../web/src/consultation.js';
import { MODES, CHECKS, MAX_BYPASSES, MIN_REASON_WORDS } from './craft.js';
import { wonderLyrics } from './wonder-lyrics.js';
import { MIN_TROUBLES, MAX_PROBLEM_WORDS } from '../../web/src/plot-trouble.js';
import { ROLES, SETS, STANZA, ARC, SECTIONS, NAMES, AGENT_BOT, HAND_CUES, ACTS, LIGHT_MOODS, MAX_LINE_SYLLABLES, MAX_REPLY_SYLLABLES, roleMenu, agentType, progressionMenu, parsePrompt } from './vocab.js';
import { SEEDS, curatedSlug } from '../../web/src/curated.js';
import { activityOf, activityProblems, sessionTexts, sessionDir, readAttempts, writeActivity, noteSession, notedSessions, priorActivity, withPrior, ACTIVITY_FILE, PRIOR_ACTIVITY_FILE } from './activity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PROMPTS = join(REPO, 'director/prompts');
const EMIT_JS = join(HERE, 'emit.js');
const WORKFLOW_JS = join(HERE, 'workflow.js');
export const TOOLSET = ['bash', 'read_file', 'workflow']; // the crew needs a shell for the emit command; the director the Workflow tool
export const WEB_TOOLS = ['web_search', 'web_fetch']; // the director's research on a premise about something real (on by default; --no-web)
/** The roles launched first (the rest in ROLES order): the critical path, then the plot's trouble. */
const LAUNCH_FIRST = ['trouble', 'lyrics'];
/**
 * How many agents Muse Code's Workflow runs at once on a host with `cpus` CPUs (host.budget.localConcurrencyCap,
 * measured Nov 5 on Muse 1.4.14: Linux with 2 or 4 CPUs -> 2, this Mac's 16 -> 14; no setting or variable moves it).
 * In a Vercel Sandbox (2 vCPUs then; Hobby allows 4) only Green and Black ever ran: the other six waited for a free
 * seat that never came, the crew could not consult, and every production run died (Nov 2 and Nov 4: `subagents: 2`).
 */
export const workflowCap = (cpus = availableParallelism()) => Math.max(2, cpus - 2);
/**
 * Who runs the crew: "workflow" (the director launches the Muse Workflow, as on a roomy host) or "processes" (this
 * orchestrator starts each crew agent as its own Muse session, all eight at once: a host where the Workflow would
 * seat fewer than the crew). --crew sets it; the hosted runner always says processes.
 */
export const defaultCrewMode = (cpus = availableParallelism()) => (workflowCap(cpus) >= ROLES.length ? 'workflow' : 'processes');
export const CREW_MODES = ['workflow', 'processes'];
/** s kept for the lyric pass (Muse Wonder) at the end of a budget: the crew and its repairs stop this much earlier. */
const WONDER_RESERVE_S = 150;
/** s a repair needs at least to be worth starting (a crew's start-up and a few beats). */
const MIN_REPAIR_S = 240;
const BUNDLE_FILES = ['beats.json', 'events.ndjson', 'director.json', ACTIVITY_FILE]; // (the activity log when it could be recorded)

// ---------------------------------------------------------------------------------------------
// Prompts

const read = (f) => readFileSync(join(PROMPTS, f), 'utf8').trim();
const fill = (tpl, vars) => tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
const list = (xs) => xs.map((x) => `\`${x}\``).join(', ');

function sectionsText() {
  return SECTIONS.map((s, i) => `  ${i + 1}. ${s} (${STANZA[s]} lines): ${ARC[s]}`).join('\n');
}
function chordSetsText() {
  const label = { 'intro:scene': 'intro (sets the scene, ends on G)', 'verse:narrative': 'verse1 / verse2 (tells the story, home on C)',
    'verse:build': 'verse1b / verse2b (builds to G, into the chorus)', 'chorus:bright': 'chorus 1 and 2 (bright; the arranger ends every chorus G7 C)',
    'chorus3:lift': 'chorus 3 (lifts: starts away from home)', 'bridge:suspense': 'bridge (suspense)', 'bridge:tender': 'bridge (tender)',
    'bridge2:suspense': 'bridge2 (suspense: never home)', 'bridge2:tender': 'bridge2 (tender: leans on G)', 'outro:conclusive': 'outro (conclusive)', 'outro:soft': 'outro (soft)' };
  return progressionMenu().map(([job, opts]) => `  - ${label[job] ?? job}: ${opts.slice(0, 3).map((o) => `[${o}]`).join(' or ')}`).join('\n');
}
/** What the generator's parser reads in a prompt (web/src/gen/prompt.js): a hint for the plan. */
function promptHints(prompt) {
  try {
    const p = parsePrompt(prompt);
    const bits = [];
    if (p.names?.length) bits.push(`it names ${p.names.join(', ')}`);
    if (p.sets?.length) bits.push(`its words point to the set${p.sets.length > 1 ? 's' : ''} ${p.sets.join(', ')}`);
    if (p.subject) bits.push(`its subject is "${p.subject}"`);
    return bits.length ? `The premise's words: ${bits.join('; ')}.` : '';
  } catch { return ''; }
}
/** The shared variables of every prompt. */
function vars(ctx, agent = null) {
  return {
    EMIT: ctx.emit, PROMPT: ctx.prompt, WORKFLOW: ctx.workflow ?? WORKFLOW_JS, ARGS: '{}',
    AGENT: agent ?? '', BOT: agent ? AGENT_BOT[agent] : '', NAMES: NAMES.join(', '),
    SECTIONS: sectionsText(), SETS: list(SETS), HAND_CUES: list([...HAND_CUES]), ACTS: list(ACTS),
    LIGHT_MOODS: list(LIGHT_MOODS), CHORD_SETS: chordSetsText(), HINTS: promptHints(ctx.prompt), BRIEF: briefText(ctx), RESEARCH: researchText(ctx), REPO_ACCESS: repoText(ctx),
    MAX_LINE: String(MAX_LINE_SYLLABLES), MAX_REPLY: String(MAX_REPLY_SYLLABLES),
    MAX_THOUGHT: String(MAX_SUMMARY_SYLLABLES), MIN_EXCHANGES: String(MIN_EXCHANGES), MAX_MOVE: String(MAX_MOVE_SYLLABLES), MIN_ASKED: String(MIN_ASKED), MIN_CONSULTATIONS: String(MIN_CONSULTATIONS), MAX_BYPASSES: String(MAX_BYPASSES), MIN_REASON: String(MIN_REASON_WORDS), CHECKS: list(CHECKS),
    MENU: agent ? list(roleMenu(agent)) : '', CAST: read('cast.md'), EXAMPLE: read('example.md'),
    MIN_TROUBLES: String(MIN_TROUBLES), MAX_PROBLEM: String(MAX_PROBLEM_WORDS), CREW_SIZE: String(ROLES.length),
  };
}
/**
 * The premise's fact sheet (checked homework, given to the director and the crew; the web research
 * fills in around it): --brief <file>, else
 * director/briefs/<slug>.md when it exists. The story must stay true to it.
 */
export function briefText(ctx) {
  const f = ctx.brief ?? join(REPO, 'director/briefs', `${ctx.slug}.md`);
  if (!f || !existsSync(f)) return '';
  const text = readFileSync(f, 'utf8').trim();
  if (!text) return '';
  return `## The facts behind the premise (true; the story must stay true to them)

The premise is about something real. These facts are checked; build the story from them and never
invent a detail they contradict (no prize, place or event the facts do not name). Names these facts
give may be sung (they are not brands here).

${text}`;
}
/** The director's research step (web tools on): check a real-world premise before planning. */
export function researchText(ctx) {
  if (!ctx.web) return '';
  return `## Step 0: do the homework (web_search, web_fetch)

If the premise is about something real (an event, a place, a product, a person, a contest, a
holiday, a science fact), research it before you plan: web_search for it, web_fetch the official
page or two, and note what is true (names, dates, what happens, what the prize or outcome really
is). Never invent a detail the sources do not support (no trophy, prize or place they do not name);
the fact sheet above, when there is one, is checked and wins over anything you find. Keep it short:
at most 4 searches and 4 fetches, then plan. Put what you learned in the plan's "facts": up to 10
short, plain sentences the crew writes from (each with its source's domain in parentheses). A pure
make-believe premise needs no research: skip this step and leave "facts" out.

The facts are the story, not decoration: a premise about something real is told through what really
happens there. Every beat's summary shows a real part of it (for a hackathon: signing up, the
kickoff, building with the event's tools, the deadline, the judges, the finals), the cast's traits
color how they live through it, and nothing drifts to an unrelated plot (no pancakes, syrup or soup
unless the facts bring them). When the premise has the bots take part, their entry is Musical Bots
itself (this show: sixteen bots who write, stage and sing a musical from a one-line prompt).`;
}
/**
 * The project's own repository, read-only (on by default; --no-repo): the director (and the crew,
 * briefly) may read this repo and its git history, so a premise about the project itself (the
 * hackathon episode) is told from real commits. Muse runs in a scratch workspace; its shell and
 * read_file reach the repo by absolute path ($MB_REPO; measured Oct 30: `git -C "$MB_REPO" log`,
 * `ls` and read_file all work under the run's flags). Read only: the prompt forbids writes there.
 */
export function repoText(ctx) {
  if (!ctx.repo) return '';
  return `## The project itself (read-only: its files and git history)

This show's own repository is at \`${ctx.repo}\` (also \`$MB_REPO\`): its code, docs, episodes and
its git history (every commit since the first). When the premise is about the project itself (the
bots, how they were built, the hackathon they entered), tell it from what really happened: before
you plan, look with read-only commands, e.g.
\`git -C "$MB_REPO" log --reverse --date=short --format='%ad %s' | head -40\`,
\`git -C "$MB_REPO" log --oneline -30\`, \`git -C "$MB_REPO" show --stat <hash>\`, \`ls "$MB_REPO"\`, and read_file on \`${ctx.repo}/README.md\` or \`${ctx.repo}/docs/SUBMISSION.md\`.
At most 6 such commands, then plan; put what you use in the plan's "facts" (short plain sentences,
each ending "(git log)" or the file it came from) so the crew sings real moments (the first commit,
a bug fixed at midnight, the day the bots first sang). Read only: never write, commit, check out,
stash or run anything else there. A premise that is not about the project needs none of this.`;
}
/** The crew's line about the repository (the director's facts usually hold what a line needs). */
function repoCrewText(ctx) {
  if (!ctx.repo) return '';
  return `\n\nThe project's repository \`${ctx.repo}\` (\`$MB_REPO\`) is readable, read-only: when the plan's
facts are about the project itself and a line needs a real detail, one quick look is fine
(\`git -C "$MB_REPO" log --oneline -20\`, read_file on a file there). Never write there.`;
}
/** One crew member's agent definition prompt, in parts: its title, its role, and the crew's rules + cast + repository + brief. */
function roleParts(ctx, agent) {
  const v = vars(ctx, agent);
  const brief = briefText(ctx);
  const extra = `${repoCrewText(ctx)}\n\n${read('cast.md')}${brief ? `\n\n${brief}` : ''}`;
  return { title: `Musical Bots crew role: ${agent} (${AGENT_BOT[agent]})`, role: fill(read(`${agent}.md`), v), rules: `${fill(read('rules.md'), v)}${extra}\n` };
}
/** One crew member's agent definition prompt: its role prompt + the crew's rules. */
export function rolePrompt(ctx, agent) {
  const { title, role, rules } = roleParts(ctx, agent);
  return `${title}\n\n${role}\n\n${rules}`;
}
/** The rules file of a role in a slim overlay. */
export const rulesFile = (dir, agent) => join(dir, `crew-rules-${agentType(agent)}.md`);
/**
 * The --agents overlay: the eight role definitions. With rulesDir (a slim overlay, for a kernel that
 * caps one argument: maxArgBytes), each role's rules part (the bulk, ~21 KB a role) is written to a
 * file there and its prompt keeps the role and has the agent read the rules first (read_file).
 */
export function crewOverlay(ctx, { rulesDir } = {}) {
  return Object.fromEntries(ROLES.map((a) => {
    let prompt = rolePrompt(ctx, a);
    if (rulesDir) {
      const { title, role, rules } = roleParts(ctx, a);
      const file = rulesFile(rulesDir, a);
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(file, rules);
      prompt = `${title}

Read this first: the second half of your definition (the crew's rules, the emit command, the cast${ctx.repo ? ', the repository' : ''}
and any facts behind the premise) is in \`${file}\` (${Buffer.byteLength(rules)} bytes). Before your
first emit call, read the whole file with read_file (all of it, in as many reads as it takes). It
binds you exactly as this text does.

${role}
`;
    }
    return [agentType(a), {
      description: `${AGENT_BOT[a]}, the ${a} agent of the Musical Bots crew: adds the ${a === 'trouble' ? "plot's trouble (the problems that raise the stakes)" : a} of each beat through the emit command.`,
      prompt,
    }];
  }));
}
export function directorPrompt(ctx) {
  return fill(read('director.md'), vars(ctx)) + '\n';
}
/** The director prompt again, for a director that ended its turn before writing the plan (`said`: its last words). */
export function replanPrompt(ctx, said = '', { crew = 'workflow' } = {}) {
  return `${crew === 'processes' ? planPrompt(ctx).trimEnd() : fill(read('director.md'), vars(ctx))}

## You stopped before writing the plan

Your last session ended without beats.json${said ? `; your last words were: "${said}"` : ''}. Nobody can answer a
question here and nothing is missing: this run is headless. Keep any research you need short, then write the plan now
(Step 1, the emit command's --beats)${crew === 'processes' ? ' and hand it over (Step 2)' : ', launch the crew (Step 2) and see it through as the steps say'}.
`;
}

function repairPrompt(ctx, problems, nudge = '') {
  return `${fill(read('director.md'), vars(ctx))}

## This is a repair run

The plan (beats.json) is already written and the crew has worked on it, but the gate failed:
${problems.slice(0, 30).map((p) => `- ${p}`).join('\n')}
${nudge ? `\n${nudge}\n` : ''}
Do not plan again. Start at Step 2 if beats are missing lines (the crew resumes at the open beat),
otherwise fix the rest as Step 3 says. Then run \`${ctx.emit} --check\` and stop.
`;
}

const STEP2 = '## Step 2: run the crew';
const STEP3 = '## Step 3: check, repair, report';
/** The director's text when the host runs the crew (crew mode "processes": no Workflow tool), as its head and Step 3. */
function hostCrewParts(ctx) {
  const text = fill(read('director.md'), vars(ctx)).replace(/with the emit command \(bash\)\s+and the Workflow tool only \(/, 'with the emit command (bash) only (');
  const i = text.indexOf(STEP2), j = text.indexOf(STEP3);
  if (i < 0 || j < i) throw new Error(`director.md: "${STEP2}" and "${STEP3}" are the steps the host-run crew replaces`);
  const step3 = text.slice(j)
    .replace(/- beats with missing lines[\s\S]*?resumes at the open beat\./, '- beats with missing lines: not yours (the crew is run again for them): leave them.')
    .replace(/\(call the Workflow tool again\)/g, '(leave it: the crew is run again)');
  return { head: text.slice(0, i).trimEnd(), step3: step3.trim() };
}
/** Crew mode "processes": the director plans, then hands over (the host starts the whole crew the moment it stops). */
export function planPrompt(ctx) {
  return `${hostCrewParts(ctx).head}

## Step 2: hand the plan to the crew

When the plan is OK, end your turn with one line: the title and the hook. The ${ROLES.length} crew agents start
the moment you stop (each its own Muse Code session, all at once) and write the episode beat by beat through the
emit command; the gate checks their work, and you are called back only if it needs your fixes. Do not do the
crew's part, do not run --check now and do not wait for anything.
`;
}
/** Crew mode "processes": the director's fixes (Step 3) once the crew wrote the episode and the gate still failed. */
export function fixPrompt(ctx, problems, nudge = '') {
  const { head, step3 } = hostCrewParts(ctx);
  return `${head}

## This is a repair run

The plan (beats.json) is already written and the crew has written the episode, but the gate failed:
${problems.slice(0, 30).map((p) => `- ${p}`).join('\n')}
${nudge ? `\n${nudge}\n` : ''}
Do not plan again and do not write Green's lines. Fix the rest as Step 3 says, then run \`${ctx.emit} --check\` and stop.

${step3}
`;
}
/** What the Workflow tells each crew agent (workflow.js), for one the host starts itself; a repair's news after it. */
export function crewTask(ctx, m, { repair = null, note = '' } = {}) {
  const lines = [
    `The episode: ${ctx.prompt}`,
    `You are ${m.bot}, the ${m.agent} agent of the crew, at work alongside the ${ROLES.length - 1} others right now (each in its own session).`,
    `Begin with: ${ctx.emit} --status --as ${m.agent}`,
    `Then add your part beat by beat through ${ctx.emit}, exactly as your instructions say, and finish with: ${ctx.emit} --done ${m.agent}`,
    'Consult your crewmates as you work (your rules, "Consultations"): open your own consultations early (an ask, your real context, your question), reply in your next call to every one put to you (your blackboard says YOUR TURN: ok, ack, your reasoning, your answer, and the work it changes), and close yours (agree, thanks) once the answer shows. Take the time a good decision needs.',
    // (Nov 5: Black ended his session "pausing here until the replies land"; nobody wakes a headless session)
    `This session is headless: when you end your turn you are gone (nobody wakes you when a reply lands), so never end it to wait. While your work waits on a crewmate, check back with \`sleep 60; ${ctx.emit} --status --as ${m.agent}\` and go on as soon as your blackboard shows it; end only after --done.`,
  ];
  if (repair) lines.push(`This is a repair run: the episode is partly written and the crew resumes at the open beat (your --status shows where it is and what is still yours). Never send again what is already there. The gate said: ${repair.slice(0, 8).join('; ')}`);
  if (note) lines.push(note);
  return lines.join('\n');
}
/** A crew agent's whole prompt when the host starts it (crew mode "processes"): its definition, then its task. */
export function crewPrompt(ctx, m, o = {}) {
  return `${rolePrompt(ctx, m.agent)}\n## Your task now\n\n${crewTask(ctx, m, o)}\n`;
}
/**
 * What the last crew run kept bumping into, for the next one: the gate's refusals since the last accepted call (from
 * its log), the latest few per agent. A crew stopped for making no progress gets them as a nudge.
 */
export function rejectionsSince(work, since = -Infinity) {
  const by = {};
  for (const a of readAttempts(work) ?? []) {
    if (a.status !== 'rejected' || !a.agent || !a.problem || !(Number(a.t) >= since)) continue;
    const list = (by[a.agent] ??= []);
    if (!list.includes(a.problem)) list.push(a.problem);
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.slice(-3)]));
}
/** The nudge for one agent: its refusals, said plainly. */
const nudgeLine = (problems) => `Last time the gate refused your calls again and again, with: ${problems.map((p) => `"${p}"`).join('; ')}. Read each refusal and fix exactly what it says in your next call (the rules and the example are the bar, never lines to copy), or go on to your next beat; do not send the same thing again.`;
/** The nudge for the director (crew mode workflow: it relaunches the crew): every agent's refusals. */
const nudgeText = (rej) => (Object.keys(rej).length ? `The crew was stopped for making no progress: the gate kept refusing ${Object.entries(rej).map(([a, ps]) => `${AGENT_BOT[a]} (${a}): ${ps.map((p) => `"${p}"`).join('; ')}`).join(' | ')}.` : '');

// ---------------------------------------------------------------------------------------------
// Muse

export const museBin = (o = {}) => resolve(o.muse ?? process.env.MUSE_BIN ?? join(homedir(), '.local/bin/muse'));
const dataHome = () => process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
/**
 * The longest single argument the kernel passes to a program, in bytes with its NUL: Linux caps each
 * argv string at MAX_ARG_STRLEN (32 pages, 128 KiB), so the crew overlay (~220 KB) fails to spawn
 * there (E2BIG); macOS caps only the total (ARG_MAX, 1 MiB). Muse takes the overlay only as one
 * --agents argument (1.4.14: no file or stdin form; the director's prompt already goes by
 * --prompt-file), so over the cap the overlay goes slim (crewOverlay rulesDir). $MB_MAX_ARG_BYTES
 * overrides (the tests play Linux on any OS).
 */
export const maxArgBytes = () => Number(process.env.MB_MAX_ARG_BYTES) || (process.platform === 'linux' ? 128 * 1024 : Infinity);
/** Muse's stderr lines that say nothing about a failure (its skills catalog, the workspace it was given). */
const MUSE_NOISE = /invalid skill package|Run `muse skills|skills_catalog|Skills:|^muse:\s+workspace (root|trust):/;
/**
 * Muse's shell can't run on this host: its Linux shell sandbox needs a bubblewrap it can use, and in a Vercel Sandbox
 * (seen Nov 2: the user's processes hold every capability, Ubuntu's bwrap lacks --perms, the embedded one can't mount
 * /proc) every bash call fails with "sandbox enforcement unavailable", so the director can't run the emit command and
 * ends its turn without beats.json. The hosted runner passes --no-muse-sandbox (the microVM is the boundary).
 */
export const MUSE_SHELL_BROKEN = /sandbox enforcement unavailable|Bubblewrap is unavailable|no capability-valid system bwrap/i;
/** What Muse said about its broken shell ("Bubblewrap is unavailable for linux: ..."), or null. */
export function shellBroken(text) {
  const s = String(text ?? '');
  if (!MUSE_SHELL_BROKEN.test(s)) return null;
  return (/Bubblewrap is unavailable[^;\n\\"]*/i.exec(s)?.[0] ?? 'sandbox enforcement unavailable').slice(0, 200);
}
/** [command, args] for the Muse binary (a .js stand-in runs on this node). */
const museCmd = (bin, args) => (bin.endsWith('.js') ? [process.execPath, [bin, ...args]] : [bin, args]);

/** `muse --version` -> "1.4.14 (1.4.14-R7309.1)". */
function museVersion(bin) {
  const r = spawnSync(...museCmd(bin, ['--version']), { encoding: 'utf8', timeout: 30000 });
  return (r.stdout || '').trim().replace(/^Muse Code\s*/i, '') || null;
}

/** Sum model usage over a session and its subagents; attribute subagents to crew roles. */
export function sessionUsage(id) {
  const dir = sessionDir(id);
  if (!dir) return null;
  const add = (a, u) => { for (const [k, v] of Object.entries(u ?? {})) if (typeof v === 'number') a[k] = (a[k] ?? 0) + v; };
  const scan = (file) => {
    const usage = { calls: 0 };
    let role = null, model = null;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      if (!role) { const m = /Musical Bots crew role: ([a-z]+)/.exec(line); if (m) role = m[1]; }
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const ev = r.payload?.event;
      if (ev?.kind === 'model_completed') { add(usage, ev.usage); usage.calls++; }
      model ??= r.payload?.record?.model_id ?? null;
    }
    return { usage, role, model };
  };
  const parent = scan(join(dir, 'session.jsonl'));
  const children = [];
  const sub = join(dir, 'subagent');
  if (existsSync(sub)) for (const c of readdirSync(sub)) {
    const f = join(sub, c, 'session.jsonl');
    if (existsSync(f)) children.push({ id: c, ...scan(f) });
  }
  return { dir, parent, children };
}

/** The model catalog's USD price per million tokens for a model, if Muse cached it. */
function priceOf(model) {
  try {
    const dir = join(dataHome(), 'muse/model-catalog');
    for (const f of readdirSync(dir)) {
      const row = JSON.parse(readFileSync(join(dir, f), 'utf8')).rows?.find((r) => r.model_id === model);
      if (row?.cost) return { input: Number(row.cost.input), output: Number(row.cost.output), cached: Number(row.cost.cached), currency: row.cost.currency ?? 'USD' };
    }
  } catch { /* no catalog */ }
  return null;
}
const defaultModel = () => {
  try { return JSON.parse(readFileSync(join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'muse/settings.json'), 'utf8')).model ?? null; } catch { return null; }
};

const zeroUsage = () => ({ input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, calls: 0 });
/** The `muse exec` arguments of one session: its prompt file, the bundle as its workspace, its tools and effort. */
function museArgs({ promptFile, work, opts, effort, web, toolset, overlay = null }) {
  const args = ['exec', '--json', '--prompt-file', promptFile, '--workspace', work, '--trust-workspace',
    '--approval-mode', 'never', '--no-foreign-personal-context', ...(web ? [] : ['--disable-web-tools']), '--disable-reminders',
    // (a host that is itself the sandbox: the hosted runner's Vercel Sandbox, where Muse's bubblewrap cannot run, MUSE_SHELL_BROKEN)
    ...(opts.museSandbox === false ? ['--disable-sandbox'] : []),
    '--reasoning-effort', effort,
    '-c', `run.toolset=${JSON.stringify(toolset)}`,
    '-c', 'run.context_slimming.meta_context_note_enabled=false',
    ...(overlay ? ['--agents', JSON.stringify(overlay)] : [])];
  if (opts.model) args.push('--model', opts.model);
  if (opts.provider) args.push('--provider', opts.provider);
  return args;
}

/**
 * One Muse session as a process: its own process group (a stop reaches Muse and everything it started), its JSON stream
 * read as it comes (the session id noted at once: the LIVE making-of reads the activity from it, live.js). Returns
 * { done: Promise<{ exit, wallSeconds, sessionId, model, usage, text, stderr, shell? }>, kill(), bytes() }.
 */
function startMuse({ args, work, emit, opts, log, files, who = null }) {
  const bin = museBin(opts);
  const t0 = Date.now();
  const proc = { kill: () => {}, bytes: () => 0, exited: false };
  proc.done = new Promise((resolveRun) => {
    let child;
    try {
      child = spawn(...museCmd(bin, args), {
        cwd: work,
        // MB_REPO: the project, read-only (--no-repo leaves it out); GIT_OPTIONAL_LOCKS=0: a git look never takes the index lock
        env: { ...process.env, MB_DIRECTOR_DIR: work, MB_EMIT: emit, ...(opts.repo ? { MB_REPO: REPO, GIT_OPTIONAL_LOCKS: '0' } : {}), PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true, // its own process group: a stop reaches Muse and everything it started
      });
    } catch (e) { // (a spawn the kernel refuses, e.g. E2BIG, throws here rather than emitting 'error')
      proc.exited = true;
      resolveRun({ exit: 'spawn-error', error: e.message, wallSeconds: 0, sessionId: null, model: null, usage: zeroUsage(), text: '' });
      return;
    }
    const raw = [];
    let buf = '', sessionId = null, model = null, text = '', bytes = 0;
    const usage = zeroUsage();
    proc.bytes = () => bytes;
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        raw.push(line);
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (r.stream?.kind === 'session' && !sessionId) {
          sessionId = r.stream.id;
          noteSession(work, sessionId, who); // (the LIVE making-of reads the crew's activity from it as the run goes: live.js)
        }
        const p = r.payload ?? {};
        if (r.payload_type === 'run.model.configured') model ??= p.model_id;
        if (r.payload_type === 'run.usage') for (const m of p.models ?? []) for (const k of Object.keys(usage)) usage[k] += m[k] ?? 0;
        if (r.payload_type === 'run.terminal.completed' && p.text) text = p.text;
        if (r.payload_type === 'tool.result' && /"status":"launched"/.test(p.text ?? '')) log('workflow launched: the crew is at work');
      }
    });
    let err = '';
    child.stderr.on('data', (c) => { bytes += c.length; err += c; });
    proc.kill = () => {
      if (proc.exited) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
    };
    child.on('close', (code, signal) => {
      proc.exited = true;
      writeFileSync(`${files}-muse.jsonl`, raw.join('\n') + '\n');
      writeFileSync(`${files}-muse.err`, err);
      const shell = shellBroken(`${err}\n${raw.join('\n')}`);
      resolveRun({ exit: code ?? signal, wallSeconds: Math.round((Date.now() - t0) / 100) / 10, sessionId, model, usage, text: text.slice(0, 500),
        stderr: err.split('\n').filter((l) => l.trim() && !MUSE_NOISE.test(l)).slice(-5), ...(shell ? { shell } : {}) });
    });
    child.on('error', (e) => { proc.exited = true; resolveRun({ exit: 'spawn-error', error: e.message, wallSeconds: 0, sessionId: null, model: null, usage, text: '' }); });
  });
  return proc;
}

const sizeOf = (f) => { try { const s = statSync(f); return `${s.size}.${Math.round(s.mtimeMs)}`; } catch { return '-'; } };
const sessionDirs = new Map(); // session id -> its directory (found once)
/**
 * The run's pulse: everything that moves while anyone is at work. The stream; the gate's log of every call (accepted,
 * queued or refused) and its state; every Muse session log of the run (the director's, its Workflow's subagents', the
 * crew's own sessions: they grow with each model step and tool call); the bytes Muse printed (`bytes`).
 */
function pulseOf(work, bytes = 0) {
  const parts = [bytes, sizeOf(join(work, 'events.ndjson')), sizeOf(join(work, '.director', 'attempts.ndjson')), sizeOf(join(work, '.director', 'state.json'))];
  for (const { id } of notedSessions(work)) {
    if (!sessionDirs.get(id)) sessionDirs.set(id, sessionDir(id));
    const dir = sessionDirs.get(id);
    if (!dir) continue;
    parts.push(sizeOf(join(dir, 'session.jsonl')));
    const sub = join(dir, 'subagent');
    try { for (const c of readdirSync(sub)) parts.push(sizeOf(join(sub, c, 'session.jsonl'))); } catch { /* none */ }
  }
  return parts.join('|');
}
/** The crew's accepted work: events landed, events queued for a later beat, the open beat (and when, on the run's clock). */
function progressOf(work) {
  let events = -1;
  try { events = readEvents(work).length; } catch { /* mid-write */ }
  const s = readState(work);
  const t = s?.t0 ? Math.round((Date.now() - s.t0) / 100) / 10 : null;
  return { key: `${events}|${s?.queued ?? 0}|${s?.open ?? -1}`, events, t };
}

/**
 * The watchdog of a Muse run (the director with its Workflow crew, or the crew the host runs). It stops
 *  - a stalled crew: nothing at all for opts.stall s: no call through the gate (accepted, queued or refused), no event,
 *    no line in any Muse session log, no byte from Muse. (Before Nov 5 it counted landed events only, and on Nov 4 it
 *    stopped a crew that was busy the whole time, thinking and fixing refused lines: two runs killed at 240 s each.)
 *  - a crew that is busy but gets nowhere: no call accepted (no event landed or queued, no beat closed) for
 *    opts.progress s, a loop of refusals: the next run gets the refusals as a nudge (rejectionsSince);
 *  - a finished crew with an agent idling on: the episode passes the gate and no event landed for opts.settle s;
 *  - the run's own timeout (its share of the budget).
 * Before the plan exists (research, planning) only the timeout applies. stop(why, message, since) is called once.
 * Returns the function that ends the watch.
 */
function watch({ work, opts, timeout, bytes, stop }) {
  let pulse = null, pulseAt = Date.now(), progress = null, progressAt = Date.now(), progressT = null, events = -1, eventsAt = Date.now(), checkedAt = 0;
  const timer = setTimeout(() => stop('timeout', `timeout after ${Math.round(timeout)}s`), timeout * 1000);
  const tick = setInterval(() => {
    const now = Date.now();
    if (!existsSync(join(work, 'beats.json'))) { pulseAt = progressAt = eventsAt = now; return; }
    const p = pulseOf(work, bytes());
    if (p !== pulse) { pulse = p; pulseAt = now; }
    const g = progressOf(work);
    if (g.key !== progress) { progress = g.key; progressAt = now; progressT = g.t; }
    if (g.events !== events) { events = g.events; eventsAt = now; }
    // (the gate is a few processes: asked at most every 10 s)
    if ((now - eventsAt) / 1000 > opts.settle && now - checkedAt > 10_000) {
      checkedAt = now;
      if (checkBundle(work).ok) return stop('settled', `the episode passes the gate and no event landed for ${opts.settle}s`);
    }
    if ((now - pulseAt) / 1000 > opts.stall) return stop('stall', `the whole crew is silent (no call, no event, no Muse activity) for ${opts.stall}s`);
    if ((now - progressAt) / 1000 > opts.progress) return stop('no-progress', `the crew is busy but no call was accepted for ${opts.progress}s`, progressT);
  }, 2000);
  return () => { clearTimeout(timer); clearInterval(tick); };
}

/**
 * One headless director session: its prompt, the crew overlay when it launches the Workflow (crew mode "workflow").
 * Streams progress to log(). Resolves { kind, exit, wallSeconds, sessionId, model, usage (Muse's own run.usage, the
 * director's), text, stopped? (why the watchdog stopped it), since? (no-progress: when the last call was accepted) }.
 */
async function runMuse({ kind, promptText, overlay = null, work, emit, opts, log, timeout = opts.timeout }) {
  const promptFile = join(work, '.director', `${kind}-prompt.md`);
  writeFileSync(promptFile, promptText);
  const args = museArgs({ promptFile, work, opts, effort: opts.directorEffort, web: opts.web, toolset: opts.web ? [...TOOLSET, ...WEB_TOOLS] : TOOLSET, overlay });
  const proc = startMuse({ args, work, emit, opts, log, files: join(work, '.director', kind) });
  let stopped = null, since = null;
  const stop = (why, message, at = null) => { if (stopped) return; stopped = why; since = at; log(`${message}: stopping Muse`); proc.kill(); };
  const end = watch({ work, opts, timeout, bytes: proc.bytes, stop });
  const onSignal = () => stop('interrupted', 'interrupted');
  process.once('SIGINT', onSignal);
  const r = await proc.done;
  end();
  process.removeListener('SIGINT', onSignal);
  return { kind, ...r, ...(stopped ? { stopped } : {}), ...(since !== null ? { since } : {}) };
}

/** The crew in launch order: Green first, then Black (whose problems need the early verses), then the rest. */
const crewMembers = (opts) => [...ROLES].sort((x, y) => LAUNCH_FIRST.indexOf(y) - LAUNCH_FIRST.indexOf(x))
  .map((a) => ({ agent: a, bot: AGENT_BOT[a], agentType: agentType(a), effort: a === 'lyrics' ? opts.lyricsEffort : opts.effort }));

/** How often the host starts a crew member again that ended its session before --done, in one crew run. */
const MAX_RESTARTS = 4;
/** s before such a member starts again (its wait was for a crewmate: give the crew a moment), the first time and after. */
const RESTART_S = [20, 60];
/** A crew member's next session after it ended one without --done: where it was, and how to wait in a headless run. */
export const continueNote = (ctx, agent, said = '') => `You ended your last session before \`${ctx.emit} --done ${agent}\`${said ? ` (your last words: "${said.slice(0, 200)}")` : ''}. This run is headless: a session that ends is gone until the host starts you again, so nobody could wake you when a reply landed. Go on from where the episode is: run \`${ctx.emit} --status --as ${agent}\` now (the open beat, your consultations, what is yours to do), and never send again what is already there.`;

/**
 * The crew, run by this host (crew mode "processes"): each of the eight agents its own Muse session with its role's
 * definition and task (crewPrompt), all started at once, under one watchdog (a stop stops them all). A member whose
 * session ends before its --done (Nov 5: Black "pausing here until the replies land", a headless session that is then
 * gone, his act-2 problem with it) starts again after a moment with a note (continueNote), MAX_RESTARTS times at most.
 * notes: a line per agent for this run (a repair's nudge); repair: the gate's problems (a repair run). Resolves
 * { kind, exit (0 when every member's last session ended well), wallSeconds, sessions: [{ agent, exit, sessionId,
 * usage }], usage, model, stopped?, since? }.
 */
async function runCrew({ kind, work, ctx, opts, log, timeout, repair = null, notes = {} }) {
  const t0 = Date.now();
  const members = crewMembers(opts);
  const procs = [], sessions = [], last = {}, count = {}, waits = new Set();
  let stopped = null, since = null, pending = 0, finish;
  const finished = new Promise((ok) => { finish = ok; });
  const settleIfDone = () => { if (!pending) finish(); };
  const start = (m, note = '') => {
    const k = (count[m.agent] = (count[m.agent] ?? 0) + 1);
    const name = k > 1 ? `${kind}-${m.agent}-${k}` : `${kind}-${m.agent}`;
    const promptFile = join(work, '.director', `${name}-prompt.md`);
    writeFileSync(promptFile, crewPrompt(ctx, m, { repair, note: [notes[m.agent] ? nudgeLine(notes[m.agent]) : '', note].filter(Boolean).join('\n') }));
    // (the crew's tools: the shell for the emit command and read_file; never the web)
    const args = museArgs({ promptFile, work, opts, effort: m.effort, web: false, toolset: ['bash', 'read_file'] });
    const p = startMuse({ args, work, emit: ctx.emit, opts, log, files: join(work, '.director', name), who: m.agent });
    procs.push(p);
    pending++;
    p.done.then((r) => {
      const s = { agent: m.agent, exit: r.exit, sessionId: r.sessionId, usage: r.usage, ...(r.shell ? { shell: r.shell } : {}) };
      sessions.push(s);
      last[m.agent] = { ...s, stderr: r.stderr, model: r.model };
      // (ended well but not done: its work waits on the crew; started again in a moment, unless the run is over)
      if (!stopped && r.exit === 0 && !readState(work)?.done?.[m.agent] && count[m.agent] <= MAX_RESTARTS) {
        const said = lastWords(r);
        const delay = RESTART_S[Math.min(count[m.agent] - 1, RESTART_S.length - 1)];
        log(`${m.bot} (${m.agent}) ended its session before --done${said ? ` ("${said.slice(0, 120)}")` : ''}: starting it again in ${delay}s`);
        const w = setTimeout(() => { waits.delete(w); if (stopped) { pending--; settleIfDone(); return; } start(m, continueNote(ctx, m.agent, said)); pending--; }, delay * 1000);
        waits.add(w);
        return;
      }
      pending--;
      settleIfDone();
    });
    return p;
  };
  for (const m of members) start(m);
  log(`the crew is at work: ${members.length} Muse Code sessions at once (${members.map((m) => m.bot).join(', ')})`);
  const stop = (why, message, at = null) => {
    if (stopped) return;
    stopped = why; since = at;
    log(`${message}: stopping the crew`);
    for (const p of procs) p.kill();
    for (const w of waits) { clearTimeout(w); waits.delete(w); pending--; }
    settleIfDone();
  };
  const end = watch({ work, opts, timeout, bytes: () => procs.reduce((n, p) => n + p.bytes(), 0), stop });
  const onSignal = () => stop('interrupted', 'interrupted');
  process.once('SIGINT', onSignal);
  await finished;
  end();
  process.removeListener('SIGINT', onSignal);
  const usage = zeroUsage();
  for (const s of sessions) for (const k of Object.keys(usage)) usage[k] += s.usage?.[k] ?? 0;
  const ends = members.map((m) => last[m.agent]).filter(Boolean);
  const bad = ends.find((r) => r.exit !== 0);
  const shell = sessions.find((s) => s.shell)?.shell;
  log(`the crew is done (${ends.map((c) => `${AGENT_BOT[c.agent]} ${c.exit}${count[c.agent] > 1 ? ` after ${count[c.agent]} sessions` : ''}`).join(', ')})`);
  return { kind, crew: true, exit: bad ? bad.exit : 0, wallSeconds: Math.round((Date.now() - t0) / 100) / 10, sessionId: null, sessions,
    model: ends.find((r) => r.model)?.model ?? null, usage, text: '', stderr: bad?.stderr ?? [], ...(shell ? { shell } : {}),
    ...(stopped ? { stopped } : {}), ...(since !== null ? { since } : {}) };
}

/** Print the crew's events as they land (the console making-of). */
function follow(work, log) {
  let seen = 0;
  const tick = () => {
    let events = [];
    try { events = readEvents(work); } catch { return; }
    for (const e of events.slice(seen)) log(`${String(e.t).padStart(6)}s ${e.bot.padEnd(7)} ${e.beat.padEnd(16)} ${e.lyric ? `♪ ${e.lyric}` : `${e.summary}${e.action ? ` [${e.action}]` : ''}`}`);
    seen = events.length;
  };
  const id = setInterval(tick, 1000);
  return () => { clearInterval(id); tick(); };
}

// ---------------------------------------------------------------------------------------------
// The run

const TIERS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
/** An effort tier, raised to a floor ("low" at least "high" is "high"; "max" stays "max"). */
export const atLeast = (e, floor) => (TIERS.indexOf(e) >= TIERS.indexOf(floor) ? e : floor);

/** A run's last words, on one line (300 characters at most). */
const lastWords = (run) => String(run?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * A resumed run's bundle made ready to go on (--resume: a hosted run whose sandbox died, its kept files put back in a
 * new one). Its scratch (.director/) is new, so the gate's state is rebuilt from the bundle (emit.js rebuildState),
 * with the clock set so what follows continues right after the last thing recorded (the making-of has no dead time);
 * the earlier activity is kept aside (PRIOR_ACTIVITY_FILE: the live log and the recorded one start with it).
 * Returns { clock (the making-of's zero, ms), prior (the earlier director.json, or null) }.
 */
function resumeBundle(work, { prompt, slug, opts, log }) {
  const lines = (f) => { try { return readFileSync(join(work, f), 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; } };
  let prior = null;
  try { prior = JSON.parse(readFileSync(join(work, 'director.json'), 'utf8')); } catch { /* none kept */ }
  const queued = lines('queued.ndjson');
  const before = lines(ACTIVITY_FILE);
  if (!existsSync(join(work, 'events.ndjson'))) writeFileSync(join(work, 'events.ndjson'), '');
  const events = readEvents(work);
  rmSync(join(work, '.director'), { recursive: true, force: true });
  mkdirSync(join(work, '.director'), { recursive: true });
  for (const f of ['queued.ndjson', ACTIVITY_FILE, 'director.json']) rmSync(join(work, f), { force: true });
  if (before.length) writeFileSync(join(work, '.director', PRIOR_ACTIVITY_FILE), before.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const last = Math.max(0, ...events.map((e) => Number(e.t) || 0), ...queued.map((q) => Number(q.t) || 0), ...before.map((a) => Number(a.t) || 0));
  const clock = Date.now() - Math.ceil((last + 1) * 1000);
  const state = rebuildState(work, { t0: clock, prompt, slug, seed: `muse-${slug}`, craft: opts.craft, queued,
    prior: { ...(prior?.craft ?? {}), rejected: prior?.turnstile?.rejected, queued: prior?.turnstile?.queued } });
  log(`resuming the run: ${events.length} events, ${queued.length} queued, the open beat ${readBeats(work)?.beats?.[state.open]?.id ?? '?'}; the making-of goes on at ${Math.round(last + 1)} s`);
  return { clock, prior };
}

/** Direct one episode. Returns { ok, out, gate, provenance }. */
export async function direct(prompt, o = {}) {
  const opts = { effort: 'low', timeout: 1500, stall: 300, settle: 75, progress: 540, repairs: 3, budget: null, web: true, repo: true, craft: 'strict', ...o };
  if (!MODES.includes(opts.craft)) throw new Error(`--craft: one of ${MODES.join(', ')}`);
  opts.crew ??= process.env.MB_CREW || defaultCrewMode();
  if (!CREW_MODES.includes(opts.crew)) throw new Error(`--crew: one of ${CREW_MODES.join(', ')}`);
  // the story is made in two places: the plan (one director session) and Green's lines; they think
  // harder by default, the seven other roles place cues at low effort
  // (measured: high costs about the same tokens as medium; Green's lines and the plan read clearly better)
  opts.lyricsEffort ??= atLeast(opts.effort, 'high');
  opts.directorEffort ??= atLeast(opts.effort, 'high');
  const log = opts.log ?? ((m) => process.stderr.write(`[direct] ${m}\n`));
  const slug = opts.slug ?? curatedSlug(prompt) ?? slugify(prompt);
  const out = resolve(opts.out ?? join(REPO, opts.live ? 'episodes/live' : 'episodes', slug));
  const inPlace = Boolean(opts.live || opts.inPlace);
  // a resumed run goes on from its bundle (in place, with a plan; without one it starts over, its earlier record kept)
  const resume = Boolean(opts.resume && inPlace && existsSync(join(out, 'beats.json')));
  let earlier = null;
  if (opts.resume && !resume) try { earlier = JSON.parse(readFileSync(join(out, 'director.json'), 'utf8')); } catch { /* none */ }
  if (inPlace && !resume) rmSync(out, { recursive: true, force: true });
  const work = inPlace ? out : mkdtempSync(join(tmpdir(), `mb-direct-${slug}-`));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  // the budget (--budget s: the hosted run's, so it ends well before its sandbox does): every Muse run gets what is
  // left of it, a repair starts only with MIN_REPAIR_S to go, and the lyric pass keeps its WONDER_RESERVE_S
  const deadline = opts.budget ? t0 + opts.budget * 1000 : Infinity;
  const left = () => (deadline - Date.now()) / 1000 - (opts.wonder === false ? 0 : WONDER_RESERVE_S);
  const timeoutFor = () => Math.max(60, Math.min(opts.timeout, left()));
  let clock = t0, prior = earlier;
  if (resume) ({ clock, prior } = resumeBundle(work, { prompt, slug, opts, log }));
  else {
    mkdirSync(join(work, '.director'), { recursive: true });
    initState(work, { prompt, slug, seed: `muse-${slug}`, t0, craft: opts.craft });
  }
  const emit = join(work, '.director', 'emit');
  writeFileSync(emit, `#!/bin/sh\nexec "${process.execPath}" "${EMIT_JS}" --dir "${work}" "$@"\n`);
  chmodSync(emit, 0o755);
  // (the crew in launch order: Green first, then Black, whose problems need the early verses; measured Nov 1, a
  // Workflow without maxParallelAgents ran seven at once and the eighth joined minutes late)
  const crew = [...ROLES].sort((x, y) => LAUNCH_FIRST.indexOf(y) - LAUNCH_FIRST.indexOf(x)).map((a) => ({ agent: a, bot: AGENT_BOT[a], agentType: agentType(a), ...(a === 'lyrics' && opts.lyricsEffort !== opts.effort ? { effort: opts.lyricsEffort } : {}) }));
  const args = { emit, brief: prompt, effort: opts.effort, crew };
  // the run's own copy of the crew workflow, its args baked in (a director may pass them as a string; a repair's
  // nudges for the crew go in it too)
  const workflow = join(work, '.director', 'workflow.js');
  const writeWorkflow = (a) => writeFileSync(workflow, readFileSync(WORKFLOW_JS, 'utf8').replace('const BAKED = {};', `const BAKED = ${JSON.stringify(a)};`));
  writeWorkflow(args);
  const ctx = { prompt, slug, emit, workflow, args, brief: opts.brief ? resolve(opts.brief) : undefined, web: opts.web, repo: opts.repo ? REPO : undefined };
  let overlay = null;
  if (opts.crew === 'workflow') {
    overlay = crewOverlay(ctx);
    const argBytes = (x) => Buffer.byteLength(JSON.stringify(x)) + 1;
    if (argBytes(overlay) > maxArgBytes()) {
      overlay = crewOverlay(ctx, { rulesDir: join(work, '.director') });
      log(`the crew overlay is over this system's ${maxArgBytes()}-byte argument cap: each role reads its rules from .director/crew-rules-*.md (${argBytes(overlay)} bytes on the command line)`);
      if (argBytes(overlay) > maxArgBytes()) throw new Error(`the slim crew overlay (${argBytes(overlay)} bytes) is still over this system's ${maxArgBytes()}-byte argument cap`);
    }
    writeFileSync(join(work, '.director', 'agents.json'), JSON.stringify(overlay, null, 1));
  }
  const firstPrompt = opts.crew === 'processes' ? planPrompt(ctx) : directorPrompt(ctx);
  writeFileSync(join(work, '.director', 'director-prompt.md'), firstPrompt);
  if (opts.dryRun) {
    log(`dry run: prompts${overlay ? ' and the crew overlay' : ''} are in ${join(work, '.director')}`);
    return { ok: true, dry: true, out, work, overlay, crew: opts.crew, directorPrompt: firstPrompt, ...(opts.crew === 'processes' ? { crewPrompts: Object.fromEntries(crewMembers(opts).map((m) => [m.agent, crewPrompt(ctx, m)])) } : {}) };
  }
  const muse = { bin: museBin(opts), version: museVersion(museBin(opts)) };
  log(`${prompt} -> ${out}${inPlace ? '' : ` (working in ${work})`}; Muse Code ${muse.version ?? '?'}, effort ${opts.effort} (director ${opts.directorEffort}, lyrics ${opts.lyricsEffort}); the crew: ${opts.crew === 'processes' ? `${ROLES.length} sessions run by this host` : 'the Workflow'}${opts.budget ? `; budget ${opts.budget} s` : ''}`);
  const stop = follow(work, log);
  const runs = [];
  const director = (kind, promptText) => runMuse({ kind, promptText, overlay, work, emit, opts, log, timeout: timeoutFor() });
  const crewRun = (kind, extra = {}) => runCrew({ kind, work, ctx, opts, log, timeout: timeoutFor(), ...extra });
  if (!readBeats(work)) {
    runs.push(await director('direct', firstPrompt));
    // a director that ended its turn before writing the plan (seen Nov 2 on the hosted runner: five calls, the research
    // done, no beats.json, exit 0): what it said last goes in the log, and it is asked once more to plan and go on
    // (a shell that can't run at all is not asked again: every call fails the same way, MUSE_SHELL_BROKEN)
    if (!readBeats(work) && runs[0].exit !== 'spawn-error') {
      const said = lastWords(runs[0]);
      log(`the director stopped before writing the plan (exit ${runs[0].exit}${said ? `; it said: "${said}"` : ''}${runs[0].stderr?.length ? `; stderr: ${runs[0].stderr.join(' | ').slice(0, 300)}` : ''})${runs[0].shell ? '' : ': asking it to plan'}`);
      if (runs[0].shell) log(`Muse Code's shell cannot run on this host (${runs[0].shell}): the emit command never ran; a host that is itself the sandbox runs with --no-muse-sandbox`);
      else {
        runs.push(await director('direct2', replanPrompt(ctx, said, { crew: opts.crew })));
        if (!readBeats(work)) {
          const again = lastWords(runs.at(-1));
          log(`the director stopped again before the plan${again ? `; it said: "${again}"` : ''}`);
        }
      }
    }
  }
  const interrupted = () => runs.at(-1)?.stopped === 'interrupted'; // (stopped from outside: no more runs)
  if (resume) {
    // a resumed run: the crew goes on from the open beat at once, whatever the repairs allow (the host's crew, or the
    // director relaunching the Workflow as a repair run does)
    const note = 'the run stopped before the episode was finished (its sandbox is gone): the crew goes on from the open beat';
    reopenCrew(work);
    runs.push(opts.crew === 'processes' ? await crewRun('resume', { repair: [note] }) : await director('resume', repairPrompt(ctx, [note, ...checkBundle(work).problems])));
  } else if (opts.crew === 'processes' && readBeats(work) && runs.at(-1)?.exit !== 'spawn-error' && !interrupted()) {
    // crew mode "processes": the director has planned: the whole crew at once
    runs.push(await crewRun('crew'));
  }
  finalize(work); // the crew is done: what is queued for the open beat lands
  let gate = checkBundle(work);
  // repairs: as many as opts.repairs and the budget allow. Crew mode "workflow": the director (it relaunches the crew
  // for missing lines, else fixes the rest). Crew mode "processes": the crew again for missing lines (or after a
  // director's fix that was not enough), else the director's fixes. A crew stopped for making no progress hands its
  // refusals to the next run (nudges), so the same lines are not refused again.
  for (let r = 0; !gate.ok && r < opts.repairs && readBeats(work) && runs.at(-1)?.exit !== 'spawn-error' && !interrupted(); r++) {
    if (left() < MIN_REPAIR_S) { log(`gate failed (${gate.problems.length} problems) with ${Math.max(0, Math.round(left()))} s of the budget left: no time for another repair`); break; }
    const last = runs.at(-1);
    const rej = last?.stopped === 'no-progress' ? rejectionsSince(work, last.since ?? -Infinity) : {};
    log(`gate failed (${gate.problems.length} problems): repair run ${r + 1}${last?.stopped ? ` (the last run was stopped: ${last.stopped})` : ''}`);
    reopenCrew(work);
    if (opts.crew === 'processes') {
      const missing = gate.problems.some((p) => /: \d+\/\d+ lines$/.test(p));
      const fixed = Boolean(last && !last.crew && /^repair/.test(last.kind));
      runs.push(missing || fixed || !last ? await crewRun(`repair${r + 1}`, { repair: gate.problems, notes: rej })
        : await director(`repair${r + 1}`, fixPrompt(ctx, gate.problems, nudgeText(rej))));
    } else {
      writeWorkflow(Object.keys(rej).length ? { ...args, notes: Object.fromEntries(Object.entries(rej).map(([a, ps]) => [a, nudgeLine(ps)])) } : args);
      runs.push(await director(`repair${r + 1}`, repairPrompt(ctx, gate.problems, nudgeText(rej))));
    }
    finalize(work);
    gate = checkBundle(work);
  }
  stop();
  // the lyric pass: Muse Wonder writes the sung lines from the crew's drafts, through the same gates (wonder-lyrics.js);
  // it never fails the run: a line (or the whole pass) that does not pass leaves the crew's own lyrics. With a budget it
  // gets what is left of it (WONDER_RESERVE_S at least, when the crew kept to its share)
  let lyrics = null;
  if (gate.ok && opts.wonder !== false && !process.env.MB_NO_WONDER && process.env.META_API_KEY) {
    const room = Number.isFinite(deadline) ? (deadline - Date.now()) / 1000 : Infinity;
    if (room < 45) lyrics = { ok: false, error: `no time left in the budget (${Math.max(0, Math.round(room))} s)` };
    else {
      log("Muse Wonder is writing the sung lyrics from the crew's drafts");
      let timer = null;
      const late = Number.isFinite(room) ? new Promise((ok) => { timer = setTimeout(() => ok({ ok: false, error: `out of time after ${Math.round(room)} s` }), room * 1000); }) : null;
      lyrics = await (late ? Promise.race([wonderLyrics(work, { log }), late]) : wonderLyrics(work, { log }));
      clearTimeout(timer);
    }
    log(lyrics.ok ? `Muse Wonder wrote ${lyrics.written} of ${lyrics.lines} lines (${lyrics.kept} stay as the crew wrote them), ${lyrics.rounds} round(s), ${lyrics.seconds} s, $${lyrics.usd}`
      : `Muse Wonder's lyrics not used (${lyrics.error}): the crew's stand`);
    if (lyrics.ok) gate = checkBundle(work);
  }
  const activity = recordActivity({ runs, work, t0: clock, log });
  const provenance = provenanceOf({ prompt, slug, opts, muse, runs, gate, work, startedAt, t0, activity, lyrics, prior, resumed: resume || Boolean(opts.resume) });
  writeFileSync(join(work, 'director.json'), JSON.stringify(provenance, null, 2) + '\n');
  log(gate.ok ? `GATE OK: ${gate.stats.events} events, ${gate.stats.lines} lines, ${gate.stats.consultations} consultations (${gate.stats.consult ? `${gate.stats.consult.complete} complete, ${gate.stats.consult.moves} lines, ${gate.stats.consult.followups} with a follow-up, ${gate.stats.consult.applied} applied` : `${gate.stats.answers} answered`}), ${gate.stats.trouble ? `${gate.stats.trouble.resolved} plot troubles (${gate.stats.trouble.pitched} pitched, ${gate.stats.trouble.accepted} accepted), ` : ''}${gate.stats.bypasses.length} craft bypasses; ${provenance.wallSeconds}s, ${provenance.usage.total.input_tokens} input tokens, ~$${provenance.cost?.usd ?? '?'}`
    : `GATE FAILED:\n${gate.problems.map((p) => `  - ${p}`).join('\n')}`);
  if (!inPlace && gate.ok) {
    mkdirSync(out, { recursive: true });
    const files = BUNDLE_FILES.filter((f) => existsSync(join(work, f)));
    if (!files.includes(ACTIVITY_FILE)) rmSync(join(out, ACTIVITY_FILE), { force: true }); // (an older run's log is not this one's)
    for (const f of files) copyFileSync(join(work, f), join(out, `${f}.tmp`));
    for (const f of files) renameSync(join(out, `${f}.tmp`), join(out, f));
  }
  if (gate.ok && !opts.keep) rmSync(join(work, '.director'), { recursive: true, force: true });
  if (gate.ok && !inPlace && !opts.keep) rmSync(work, { recursive: true, force: true });
  else if (!gate.ok) log(`the failed run is kept in ${work}`);
  return { ok: gate.ok, out, work, gate, provenance };
}

/**
 * The production's activity log (activity.js): what the director and the crew really did and when, from Muse's
 * session logs (the director's and each crew subagent's tool calls) and the emit tool's own log, sanitized;
 * written to the bundle (activity.ndjson) for the making-of to sing. An entry that still looks like a local path or
 * a secret is dropped. Returns the log, or null when nothing could be recorded.
 */
function recordActivity({ runs, work, t0, log }) {
  try {
    // (the director's sessions with their Workflow's subagents; a crew the host ran: each agent's own session)
    const sessions = runs.flatMap((r) => (r.sessions ? r.sessions.filter((s) => s.sessionId).flatMap((s) => sessionTexts(sessionDir(s.sessionId), { who: s.agent }))
      : r.sessionId ? sessionTexts(sessionDir(r.sessionId)) : []));
    const attempts = readAttempts(work);
    let list = activityOf({ sessions, attempts, events: readEvents(work), t0 });
    // (a resumed run: what was recorded before it died comes first)
    list = withPrior(priorActivity(work), list).filter((e) => !activityProblems([e]).some((p) => /local path|secret/.test(p)));
    if (!list.length) return null;
    const bad = activityProblems(list, { events: readEvents(work) });
    if (bad.length) { log(`activity log not written: ${bad.slice(0, 3).join('; ')}`); return null; }
    writeActivity(work, list);
    log(`activity: ${list.length} entries (${sessions.length} session logs, ${attempts?.length ?? 0} gate calls)`);
    return list;
  } catch (err) {
    log(`activity log not written: ${err.message}`);
    return null;
  }
}
const countBy = (list, k) => list.reduce((m, e) => ({ ...m, [e[k]]: (m[e[k]] ?? 0) + 1 }), {});

/** A repair run resumes the crew: nobody is done any more. */
function reopenCrew(work) {
  const p = join(work, '.director/state.json');
  const s = readState(work);
  if (!s) return;
  s.done = {};
  writeFileSync(p, JSON.stringify(s, null, 1));
}

const LYRICS_BASIS = 'muse-wonder-1.0 at $4/M input, $0.2/M cached, $20/M output (dev.meta.ai pricing); usd above, when present, is the director and the eight agents';
function provenanceOf({ prompt, slug, opts, muse, runs, gate, work, startedAt, t0, activity = null, lyrics = null, prior = null, resumed = false }) {
  const events = readEvents(work);
  const sessions = runs.map((r) => ({ run: r, s: r.sessionId ? sessionUsage(r.sessionId) : null }));
  const zero = () => ({ input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, calls: 0 });
  const add = (a, u) => { for (const k of Object.keys(a)) a[k] += u?.[k] ?? 0; return a; };
  const director = zero(), crew = zero(), perRoleUsage = {};
  for (const { run, s } of sessions) {
    if (run.sessions) {
      // (a crew the host ran: each agent's own session, its Muse helpers counted as the director's)
      for (const m of run.sessions) {
        const u = m.sessionId ? sessionUsage(m.sessionId) : null;
        const own = u ? u.parent.usage : m.usage;
        add(crew, own);
        perRoleUsage[m.agent] = add(perRoleUsage[m.agent] ?? zero(), own);
        for (const c of u?.children ?? []) add(director, c.usage);
      }
      continue;
    }
    if (!s) { add(director, run.usage); continue; }
    add(director, s.parent.usage);
    for (const c of s.children) {
      if (!c.role) { add(director, c.usage); continue; } // Muse's own helpers (titles, reminders)
      add(crew, c.usage);
      perRoleUsage[c.role] = add(perRoleUsage[c.role] ?? zero(), c.usage);
    }
  }
  // (a resumed run: its earlier sessions count too)
  if (prior?.usage) { add(director, prior.usage.director); add(crew, prior.usage.crew); }
  for (const [r, v] of Object.entries(prior?.perRole ?? {})) if (v?.usage) perRoleUsage[r] = add(perRoleUsage[r] ?? zero(), v.usage);
  const total = add(add(zero(), director), crew);
  const model = runs.find((r) => r.model)?.model ?? prior?.muse?.model ?? opts.model ?? defaultModel();
  const price = model ? priceOf(model) : null;
  const usd = price ? ((total.input_tokens - total.cached_tokens) * price.input + total.cached_tokens * price.cached + total.output_tokens * price.output) / 1e6 : null;
  const perRole = Object.fromEntries(ROLES.map((r) => [r, { bot: AGENT_BOT[r], events: events.filter((e) => e.agent === r).length, lines: events.filter((e) => e.agent === r && e.lyric).length, ...(perRoleUsage[r] ? { usage: perRoleUsage[r] } : {}) }]));
  const state = readState(work);
  const earlierLyrics = prior?.cost?.lyricsUsd ?? 0;
  return {
    director: opts.crew === 'processes' ? `Muse Code (Meta), headless: a director session + ${ROLES.length} crew sessions run at once by the host (scripts/director)`
      : `Muse Code (Meta), headless: a director session + a Workflow of ${ROLES.length} role subagents (scripts/director)`,
    muse: { version: muse.version, provider: opts.provider ?? 'meta', model, effort: opts.effort, lyricsEffort: opts.lyricsEffort, directorEffort: opts.directorEffort, web: Boolean(opts.web), repo: Boolean(opts.repo), shellSandbox: opts.museSandbox !== false, contributorMode: model ? /contributor/.test(model) : null, crew: opts.crew },
    prompt, slug, startedAt: prior?.startedAt ?? startedAt, wallSeconds: Math.round(((prior?.wallSeconds ?? 0) * 1000 + Date.now() - t0) / 100) / 10,
    makingOfSeconds: events.at(-1)?.t ?? 0,
    ...(resumed ? { resumes: (prior?.resumes ?? 0) + 1 } : prior?.resumes ? { resumes: prior.resumes } : {}),
    // (a run that failed or left no plan keeps what it said last, Muse's stderr tail and a broken shell: the failure's why;
    // a resumed run lists its earlier runs first)
    runs: [...(prior?.runs ?? []).map((r) => ({ ...r, earlier: true })), ...runs.map((r, i) => {
      const failed = r.exit !== 0 || !readBeats(work);
      return { kind: r.kind, exit: r.exit, wallSeconds: r.wallSeconds, sessionId: r.sessionId,
        subagents: r.sessions ? r.sessions.filter((m) => m.sessionId).length : sessions[i].s?.children.filter((c) => c.role).length ?? null,
        ...(r.sessions ? { crew: r.sessions.map((m) => ({ agent: m.agent, exit: m.exit, sessionId: m.sessionId })) } : {}),
        ...(r.stopped ? { stopped: r.stopped } : {}),
        ...(r.stderr?.length && failed ? { stderr: r.stderr } : {}), ...(failed && lastWords(r) ? { said: lastWords(r) } : {}), ...(r.shell ? { shell: r.shell } : {}) };
    })],
    usage: { director, crew, total },
    cost: usd !== null ? { usd: Math.round(usd * 10000) / 10000, basis: `${model} at $${price.input}/M input, $${price.cached}/M cached, $${price.output}/M output (Muse's model catalog); an estimate`,
      ...(lyrics?.ok ? { lyricsUsd: Math.round((lyrics.usd + earlierLyrics) * 10000) / 10000, totalUsd: Math.round((usd + lyrics.usd + earlierLyrics) * 10000) / 10000, lyricsBasis: LYRICS_BASIS } : {}) }
      : lyrics?.ok ? { lyricsUsd: lyrics.usd, totalUsd: lyrics.usd, lyricsBasis: LYRICS_BASIS } : null, // (the crew's price unknown: the lyric pass alone)
    perRole,
    // the sung lyrics: Muse Wonder's (the crew's drafts where a line did not pass the gates), or why not
    ...(lyrics?.ok ? { lyrics: { model: lyrics.model, lines: lyrics.lines, written: lyrics.written, kept: lyrics.kept, rounds: lyrics.rounds, seconds: lyrics.seconds, usage: lyrics.usage, usd: lyrics.usd } } : lyrics ? { lyricsSkipped: lyrics.error } : {}),
    events: events.length, lines: events.filter((e) => e.lyric).length,
    consultations: events.filter((e) => e.status === 'consulting' && e.consult?.length).length,
    answers: events.filter((e) => e.answers !== undefined).length,
    ...(gate.stats?.consult ? { consult: gate.stats.consult } : {}),
    ...(gate.stats?.trouble ? { trouble: gate.stats.trouble } : {}),
    turnstile: state ? { rejected: state.rejected ?? 0, queued: state.queued ?? 0 } : null,
    activity: activity ? { file: ACTIVITY_FILE, entries: activity.length, byWho: countBy(activity, 'who'), byKind: countBy(activity, 'kind') } : null,
    craft: {
      mode: state?.craft?.mode ?? opts.craft,
      bypasses: gate.stats?.bypasses ?? [],
      accepted: state?.craft?.accepted ?? {},
      counts: state?.craft?.counts ?? {},
    },
    gate: { ok: gate.ok, problems: gate.problems },
  };
}

// ---------------------------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const o = { positional: [] };
  const valued = new Set(['--brief', '--slug', '--out', '--effort', '--lyrics-effort', '--director-effort', '--model', '--provider', '--muse', '--timeout', '--stall', '--settle', '--progress', '--repairs', '--budget', '--crew', '--only', '--skip', '--craft']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.has(a)) o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else if (a === '--live') o.live = true;
    else if (a === '--all') o.all = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--no-web') o.web = false;
    else if (a === '--no-repo') o.repo = false;
    else if (a === '--no-wonder') o.wonder = false;
    else if (a === '--no-muse-sandbox') o.museSandbox = false;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--resume') o.resume = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else o.positional.push(a);
  }
  for (const k of ['timeout', 'stall', 'settle', 'progress', 'repairs', 'budget']) if (o[k] !== undefined) o[k] = Number(o[k]);
  return o;
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || (!o.all && !o.positional.length)) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 32).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return o.help ? 0 : 1;
  }
  if (o.all) {
    const root = resolve(o.out ?? join(REPO, 'episodes'));
    const results = [];
    const pick = (v) => (typeof v === 'string' ? new Set(v.split(',').map((x) => x.trim())) : null);
    const only = pick(o.only), skip = pick(o.skip);
    for (const [slug, prompt] of SEEDS) {
      if ((only && !only.has(slug)) || skip?.has(slug)) continue;
      const r = await direct(prompt, { ...o, slug, out: join(root, slug), live: false });
      const p = r.provenance;
      results.push({ slug, ok: r.ok, title: readBeats(r.ok ? join(root, slug) : r.work)?.title ?? null, events: r.gate?.stats?.events, wall: p?.wallSeconds, usd: p?.cost?.usd, problems: r.ok ? undefined : r.gate?.problems?.slice(0, 5) });
      console.error(`[direct] ${slug}: ${r.ok ? 'OK' : 'FAILED'} ${JSON.stringify(results.at(-1))}`);
    }
    console.log(JSON.stringify(results, null, 1));
    return results.every((r) => r.ok) ? 0 : 1;
  }
  const r = await direct(o.positional.join(' '), o);
  console.log(JSON.stringify({ ok: r.ok, out: r.out, events: r.gate?.stats?.events ?? null, wallSeconds: r.provenance?.wallSeconds ?? null, usd: r.provenance?.cost?.usd ?? null }));
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
