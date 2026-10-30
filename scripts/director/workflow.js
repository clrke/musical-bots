// The Muse Code workflow the director launches (Workflow tool: name "musical-bots-crew", this file as
// scriptPath, Workflow API V1). It starts the crew: the seven role subagents at once, each its own
// agent definition (agentType: "green-lyrics", "white-chords"... from the --agents overlay that
// scripts/director/direct.js builds out of director/prompts/<role>.md). They coordinate through the
// bundle itself: scripts/director/emit.js keeps the beat order (the turnstile) and shows each of
// them the open beat, the lines so far and the consultations addressed to it (the blackboard).
// Workflow scripts run sandboxed (no files, no clock): everything comes in through host.args, and
// direct.js also bakes the run's args into its per-run copy of this file (BAKED), so the crew starts
// right even when a director passes args as a JSON string or not at all.
//   args: { emit: "<abs path of the emit command>", brief: "<the premise>", effort?: "low",
//           crew?: [{ agent, bot, agentType, effort? }] }
const BAKED = {};
const CREW = [
  { agent: 'lyrics', bot: 'Green' }, { agent: 'chords', bot: 'White' }, { agent: 'dance', bot: 'Gray' },
  { agent: 'lighting', bot: 'Blue' }, { agent: 'deals', bot: 'Gold' }, { agent: 'hype', bot: 'Yellow' },
  { agent: 'comedy', bot: 'Pink' },
];

export default async function workflow(host) {
  let given = host.args ?? {};
  if (typeof given === 'string') { try { given = JSON.parse(given); } catch { given = {}; } }
  const args = { ...BAKED, ...(given && typeof given === 'object' ? given : {}) };
  for (const k of ['emit', 'brief']) if (!args[k] && BAKED[k]) args[k] = BAKED[k];
  const emit = args.emit;
  const crew = (Array.isArray(args.crew) && args.crew.length ? args.crew : CREW)
    .map((c) => ({ ...c, agentType: c.agentType ?? `${c.bot.toLowerCase()}-${c.agent}` }));
  const results = await host.parallel(crew.map((c) => ({
    input: [
      `The episode: ${args.brief ?? '(see the plan)'}`,
      `You are ${c.bot}, the ${c.agent} agent of the crew, at work alongside the six others right now.`,
      `Begin with: ${emit} --status --as ${c.agent}`,
      `Then add your part beat by beat through ${emit}, exactly as your instructions say, and finish with: ${emit} --done ${c.agent}`,
    ].join('\n'),
    agentType: c.agentType,
    ...(c.effort ?? args.effort ? { effort: c.effort ?? args.effort } : {}),
  })));
  const reports = results.map((r, i) => ({
    agent: crew[i].agent,
    bot: crew[i].bot,
    status: r?.status ?? null,
    error: r?.error_kind ?? null,
    text: typeof r?.text === 'string' ? r.text : null,
    notes: typeof r?.notes === 'string' && r.notes.trim() ? r.notes : null,
    ref: r?.ref ?? null,
  }));
  const failed = reports.filter((r) => r.error || (r.status && r.status !== 'completed'));
  const report = {
    status: failed.length ? 'partial' : 'complete',
    unresolved: failed.map((r) => `${r.bot} (${r.agent}): ${r.error ?? r.status}`),
    crew: reports,
    next: `Run ${emit} --check`,
  };
  return { ...report, summary: JSON.stringify(report) };
}
