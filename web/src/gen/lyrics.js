// The story a prompt becomes: eleven stanzas in the Soothing Bots story-song form (StoryBookDataV5:
// the setup, the inciting turn, the hook, the complication, the peak, the grown-up's quiet turn, the
// hook turned, the outro calling back to the intro), written in protocol v2 lyric markup:
//   "[And] {Lou:gasp} counts every cent >> Twice!"  ({Name:act} cues, [pickup], >> the pal's reply)
// The irony every story turns on (the V5 shape): the one who guards the thing (the grown-up, or the
// child the prompt names) ends up sharing it, and the rival's bigger one tips over; the grown-up's
// catchphrase comes back turned in chorus 3. A line is sung by the lead unless it starts "@L" / "@G" /
// "@R" / "@P" (the lead, the grown-up, the rival, the pal); the bridges are the grown-up's.
// Lines stay short (at most 7 sung syllables, a pickup aside), replies 1-5 syllables, and every line
// passes the lyric rules (rules.js). Pure; the rng picks among the variants that fit.
import { syllabify } from '../mv/voice/syllables.js';
import { plainLyric, parseLyric } from '../cues.js';
import { isClean } from './rules.js';
import { CAST } from './cast.js';
import { cap } from './prompt.js';

export const MAX_LINE_SYLLABLES = 7;
export const MAX_REPLY_SYLLABLES = 5;

const syll = (s) => syllabify(s).length;

// the pal's replies, by mood (short, kind, present tense)
const REPLIES = {
  hello: ['Hello!', 'Good morning!', 'Hi, hi!', 'Hooray!'],
  wow: ['Ooh!', 'Wow!', 'So shiny!', 'Fancy!', 'Ooh, big!'],
  want: ['Me too!', 'Same!', 'And me!', 'Dibs!'],
  no: ['Aw, please?', 'Not again!', 'Oh, no!', 'Aw!'],
  wait: ['Yawn!', 'Hurry up!', 'Tick-tock!'],
  uhoh: ['Uh-oh!', 'Oh no!', 'Watch out!', 'Oh dear!'],
  showoff: ['Says who?', 'Show-off!', 'Oh, really?'],
  crowd: ['Wait for me!', 'Hey!', 'Come back!'],
  whoa: ['Whoa!', 'Wobble!', 'Look out!'],
  oops: ['Oops!', 'Oh dear!', 'Yikes!'],
  hmm: ['Hmm!', 'Think, think!', 'Who knows?'],
  plan: ['A plan?', 'Tell me!', 'Ooh, what?'],
  deal: ['Deal!', 'Okay!', 'Yes!'],
  yes: ['Yes!', 'Finally!', 'Hooray!'],
  hooray: ['Hooray!', 'Yippee!', 'Yay!'],
  thanks: ['Thank you!', 'Thanks!', 'So kind!'],
  night: ['Goodnight!', 'Sleep tight!', 'Night, night!'],
};

// the set's own reply to the hook (each time it is sung)
const HOOK_REPLY = { diner: ['Yum!', 'Smells good!'], street: ['Whee!', 'Go, go!'], big_house: ['Hooray!', 'Ooh!'], studio: ['Hooray!', 'Yay!'] };

/**
 * The stanzas, by section: per line its variants (text with slots), sung by the lead unless "@X".
 * Slots: {L} {P} {G} {R} names ({G:act} a cue), {T} the subject, {theT} / {TheT} with its article,
 * {aT} as the prompt writes it, {V} / {V0} the verb, {at} where, {When} when, {cL} {cP} {cG} {cR}
 * catchphrases, {O} who the doer acts on; ~mood a reply from REPLIES[mood]. `if`: when the variant
 * applies (ctx -> bool).
 */
const STANZAS = {
  intro: [
    [{ t: '{When} {at} >> ~hello', if: (c) => c.when }, { t: 'Morning {at} >> ~hello' }, { t: 'Sunshine {at} >> ~hooray' }, { t: 'A big day {at} >> ~hooray' }],
    // the prompt's action: the grown-up's (the lead tells it), or the lead's own (the pal tells it: its own line, no reply)
    [{ t: '{D:brighten} {V} {aT} >> ~wow', if: (c) => c.doerIsGrown && c.verb && !c.ks && !c.object && !c.given },
      { t: '{ATcap}! {D:brighten} {V} {it} >> ~wow', if: (c) => c.doerIsGrown && c.verb && !c.object && !c.given },
      { t: '{D:brighten} {V} {given} >> ~wow', if: (c) => c.doerIsGrown && c.verb && c.given },
      { t: '{D:brighten} {V} {O} {at} >> ~wow', if: (c) => c.doerIsGrown && c.verb && c.object && c.at }, { t: '{D:brighten} {V} {O} >> ~wow', if: (c) => c.doerIsGrown && c.verb && c.object },
      { t: '@P {D:brighten} {V} {aT}', if: (c) => c.doerIsLead && c.verb && !c.ks && !c.object && !c.given },
      { t: '@P {D:brighten} {V} {given}', if: (c) => c.doerIsLead && c.verb && c.given },
      { t: '@P {D:brighten} {V} {O} {at}', if: (c) => c.doerIsLead && c.verb && c.object && c.at }, { t: '@P {D:brighten} {V} {O}', if: (c) => c.doerIsLead && c.verb && c.object },
      { t: '@P Here comes {D:brighten}', if: (c) => c.doerIsLead }, { t: 'Here comes {D:brighten} >> ~wow', if: (c) => !c.doerIsLead }],
  ],
  verse1: [
    [{ t: 'I {V0} {aT} >> ~wow', if: (c) => c.doerIsLead && c.verb && !c.object && !c.ks && !c.given }, { t: 'I {V0} {O} {at} >> ~want', if: (c) => c.doerIsLead && c.object },
      { t: 'I want {theT} so >> ~want', if: (c) => c.doerIsLead && c.given },
      { t: 'I want {theT} too >> ~want', if: (c) => !c.doerIsLead }, { t: 'I love {theT} so >> ~want' }, { t: 'I want a turn, please >> ~want' }],
    [{ t: '@G {cG} >> ~no' }],
    [{ t: '{G:harrumph} says: not yet >> ~no' }, { t: '[But] {G} says: wait and see >> ~hmm' }, { t: '[But] {G:harrumph} says no, no, no >> ~no' }],
    [{ t: '[So] I wait, and wait, and wait >> ~wait' }, { t: '[So] I sit and wait a while >> ~wait' }, { t: '[And] I wait and wait >> ~wait' }],
  ],
  verse1b: [
    [{ t: '[Then] {R:preen} comes along >> ~uhoh' }, { t: '[Oh,] Here comes {R:preen} >> ~uhoh' }, { t: '{R:preen} rolls up next door >> ~uhoh' }],
    [{ t: '@R {cR} >> ~showoff' }],
    [{ t: 'A bigger one, so new! >> ~wow' }, { t: '[And] One that shines and spins! >> ~wow' }, { t: '[Look,] A bigger one! >> ~wow' }],
    [{ t: '[And] Everyone runs to {R} >> ~crowd' }, { t: 'The crowd runs off to {R} >> ~crowd' }, { t: '[And] Off the crowd goes, too >> ~crowd' }],
  ],
  // chorus 1 and 2: Hook X Hook Y; chorus 3: Hook X Hook Turn (the pairs below)
  verse2: [
    [{ t: '[Uh-oh,] {R:gulp} gives a push >> ~whoa' }, { t: '[Oh no,] {R}\'s one tips over >> ~whoa' }, { t: '[Then] The big one wobbles >> ~whoa' }],
    [{ t: '@P {cP} I can help!', if: (c) => syll(`${c.cP} I can help!`) <= MAX_LINE_SYLLABLES }, { t: '@P I can help, I can!' }],
    [{ t: '{G:sigh} looks at the mess >> ~oops' }, { t: '{G:gasp} sees the mess >> ~oops' }, { t: '[And] {G:sigh} sits down >> ~oops' }],
    [{ t: '[And] Nobody knows what to do >> ~hmm' }, { t: '[So] What can anybody do? >> ~hmm' }, { t: '[Oh,] What a muddle now >> ~hmm' }],
  ],
  verse2b: [
    [{ t: '{cL} I have a plan! >> ~plan', if: (c) => /^(Trust me|Hold my juice|Actually)/.test(c.cL) }, { t: '[Wait,] I have a plan! >> ~plan' }, { t: '[Hey,] I have a plan! >> ~plan' }],
    [{ t: '[So] Share it, you and me >> ~deal' }, { t: '[So] Take turns, one by one >> ~deal' }],
    [{ t: '{R:brighten} gives a nod >> ~yes' }, { t: '[And] {R:brighten} smiles at last >> ~yes' }, { t: '[Then] {R:brighten} says okay >> ~yes' }],
    [{ t: '[And] {G:gasp} looks at me >> ~uhoh' }, { t: '[Then] {G:knowing} winks at me >> ~hooray' }, { t: '[And] {G:brighten} sees it, too >> ~yes' }],
  ],
  // the grown-up's quiet turn (no replies): the guard who learns, or the grown-up who watches the child guard it
  bridge: [
    [{ t: 'I {V0} {aT} each day', if: (c) => c.doerIsGrown && c.verb && !c.object }, { t: 'I {V0} {it} every day', if: (c) => c.doerIsGrown && c.verb }, { t: 'I keep it every day', if: (c) => c.doerIsGrown },
      { t: 'I see you, small and new', if: (c) => !c.doerIsGrown && c.tag === 'tender' }, { t: 'I watch you from the gate' }],
    [{ t: 'I keep it neat and new', if: (c) => c.doerIsGrown && c.tag === 'tender' }, { t: 'I check it, and I check', if: (c) => c.doerIsGrown }, { t: 'You hold it, oh, so tight' }],
    [{ t: 'But you just want to play', if: (c) => c.doerIsGrown && c.tag === 'tender' }, { t: 'What if it goes wrong?', if: (c) => c.tag === 'suspense' }, { t: 'I held things tight, like you' }],
    [{ t: 'And I miss the fun with you', if: (c) => c.doerIsGrown && c.tag === 'tender' }, { t: 'I wait, and hold my breath', if: (c) => c.tag === 'suspense' }, { t: 'Until I let them go' }],
  ],
  bridge2: [
    [{ t: 'I look at you and smile', if: (c) => c.tag === 'tender' }, { t: 'I take a breath, and then' }],
    [{ t: '[And] Open up my hand', if: (c) => c.tag === 'tender' }, { t: '[And] Let the moment go' }],
    [{ t: '@L {G}, can I help?', if: (c) => c.doerIsGrown }, { t: '@L {G}, can you help?', if: (c) => !c.doerIsGrown && c.tag === 'tender' }, { t: '@L {G}, is it okay?' }],
    [{ t: 'Yes! Come and help me, too', if: (c) => c.doerIsGrown && c.tag === 'tender' }, { t: 'Yes, and I help you, too', if: (c) => c.tag === 'tender' }, { t: 'It is, it is, I know' }],
  ],
  outro: [
    null, // the hook
    [{ t: 'Evening {at} >> ~night' }, { t: 'Moonlight {at} >> ~night' }],
    [{ t: '{TheT} for everyone >> ~hooray' }, { t: '[And] Some for everyone >> ~hooray' }],
    [{ t: '[And] {R:brighten} joins in, too >> ~want' }, { t: '[And] Friends on every side >> ~hooray' }],
  ],
};

/** Chorus X / Y / Turn (rhyming; the Turn means more: the guard shares). `doer: true`: the grown-up does the prompt's action. */
const CHORUSES = [
  { if: (c) => c.doerIsGrown && c.verb && !c.object, x: '{D:brighten} {V} {it} with care >> ~uhoh', y: '[But] Nobody gets a share >> ~no', turn: '@G Now there is lots to share >> ~hooray' },
  { x: '{TheT}, one for me! >> ~hooray', y: '[And] One, two, three for {P} >> ~hooray', turn: '@G [Now] One for you, from me >> ~thanks' },
  { x: '{TheT}, shiny new >> ~wow', y: '[And] {R} wants one too >> ~want', turn: '@G [So] Here is one for you >> ~thanks' },
  { x: 'So shiny and so new >> ~wow', y: '[And] {R} wants one too >> ~want', turn: '@G [So] Here is one for you >> ~thanks' },
];

/** The hook (the song's title): the subject sung twice, else with a cheer; never ending on a /ks/ sound. */
function hookOf(c) {
  const T = c.T, s = syll(T);
  const opts = [];
  if (s >= 2 && s <= 3 && !c.ks) opts.push(`${cap(T)}, ${T}!`);
  if (c.verb0 && s <= 2 && c.verb0 !== T && c.doerIsGrown) opts.push(`${cap(c.verb0)} the ${T}, ${c.verb0} the ${T}!`);
  if (s <= 4) opts.push(`${cap(c.theT)}, hooray!`);
  opts.push(`Hooray, hooray, hooray!`);
  return opts.find((h) => syll(h) >= 4 && syll(h) <= MAX_LINE_SYLLABLES && isClean(h)) ?? 'Hooray, hooray, hooray!';
}

/** A /ks/ sound at the end of a phrase ("box", "Knox", "snacks", "bakes"): the engine sings it badly. */
export const endsKs = (s) => /(x|ks|cks|kes|ques|cs)\W*$/i.test(String(s).trim());

/**
 * Fill a template's slots. Returns the v2 lyric (markup kept: names as {Name} / {Name:act} cues) and
 * its singer key, or null when a slot it needs is missing.
 */
function fill(tpl, c, rng, used) {
  let t = tpl;
  let who = 'L';
  const at = /^@([LGRP])\s+/.exec(t);
  if (at) { who = at[1]; t = t.slice(at[0].length); }
  const name = { L: c.L, P: c.P, G: c.G, R: c.R, D: c.D, O: c.object };
  let missing = false;
  t = t.replace(/\{(L|P|G|R|D|O)(?::([a-z]+))?\}/g, (_, k, act) => {
    const n = name[k];
    if (!n) { missing = true; return ''; }
    return act ? `{${n}:${act}}` : `{${n}}`;
  });
  const slots = {
    T: c.T, theT: c.theT, TheT: cap(c.theT), aT: c.aT, ATcap: cap(c.aT), V: c.verb, V0: c.verb0, at: c.at, When: c.when ? cap(c.when) : null,
    cL: c.cL, cP: c.cP, cG: c.cG, cR: c.cR, given: c.given, it: c.plural && !c.mass ? 'them' : 'it',
  };
  t = t.replace(/\{(T|theT|TheT|aT|ATcap|V|V0|at|When|cL|cP|cG|cR|given|it)\}/g, (_, k) => {
    const v = slots[k];
    if (!v) { missing = true; return ''; }
    return v;
  });
  if (missing) return null;
  t = t.replace(/~([a-z]+)/g, (_, mood) => {
    const pool = (REPLIES[mood] ?? REPLIES.hooray).filter((r) => !used.has(r));
    const r = rng.pick(pool.length ? pool : REPLIES[mood] ?? REPLIES.hooray);
    used.add(r);
    return r;
  });
  return { lyric: t.replace(/\s+/g, ' ').trim(), who, explicit: Boolean(at) };
}

/** Whether a filled line sings well: at most 7 syllables (pickup aside), a reply of 1-5, lyric rules. */
export function lineProblems(lyric) {
  const p = parseLyric(lyric);
  const probs = [];
  const rest = p.pickup ? p.text.slice(p.pickup.length).trim() : p.text;
  const n = syll(rest);
  if (n < 2 || n > MAX_LINE_SYLLABLES) probs.push(`${n} syllables`);
  if (p.reply && (syll(p.reply) < 1 || syll(p.reply) > MAX_REPLY_SYLLABLES)) probs.push('reply length');
  if (!isClean(plainLyric(lyric))) probs.push('lyric rules');
  return probs;
}

/**
 * A variant that sings well: the first one written for this story (an `if` that holds), else one of
 * the generic ones (the rng picks between the first two: variety); a /ks/ ending only when nothing else
 * fits.
 */
function choose(variants, c, rng, used) {
  const ok = [];
  for (const v of variants) {
    if (v.if && !v.if(c)) continue;
    const f = fill(v.t, c, rng, new Set(used));
    if (f && !lineProblems(f.lyric).length) ok.push({ ...f, own: Boolean(v.if), t: v.t });
  }
  if (!ok.length) return null;
  const soft = (xs) => { const s = xs.filter((f) => !endsKs(parseLyric(f.lyric).text)); return s.length ? s : xs; };
  const own = soft(ok.filter((f) => f.own));
  const pool = own.length ? [own[0]] : soft(ok);
  const pickd = pool[Math.min(pool.length - 1, Math.floor(rng() * Math.min(2, pool.length)))];
  // fill it again for real: its replies count as used
  return fill(pickd.t, c, rng, used) ?? pickd;
}

/**
 * The story of an episode: { title, hook, sections: { [section]: [{ lyric, singer, with? }] } }.
 * c: the cast and the prompt's words (index.js storyContext); rng: the episode's.
 */
export function writeStory(c, rng) {
  const hookLine = hookOf(c);
  const hookReply = rng.pick(HOOK_REPLY[c.set] ?? HOOK_REPLY.studio);
  const hook = `${hookLine} >> ${hookReply}`;
  const singerOf = (who) => ({ L: c.L, G: c.G, R: c.R, P: c.P }[who] ?? c.L);
  const out = {};
  const stanza = (section) => {
    const used = new Set();
    const lines = [];
    for (const variants of STANZAS[section]) {
      if (!variants) { lines.push({ lyric: hook, singer: c.L }); continue; }
      const f = choose(variants, c, rng, used) ?? { lyric: 'La, la, la, la, la!', who: 'L' };
      // the bridges are the grown-up's (its own "I"); a line marked @L stays the lead's
      const bridge = section === 'bridge' || section === 'bridge2';
      lines.push({ lyric: f.lyric, singer: bridge && !f.explicit ? c.G : singerOf(f.who) });
    }
    return lines;
  };
  for (const s of ['intro', 'verse1', 'verse1b', 'verse2', 'verse2b', 'bridge', 'bridge2', 'outro']) out[s] = stanza(s);
  // the choruses: Hook X Hook Y, chorus 3 Hook X Hook Turn, sung together
  const usedC = new Set();
  const pair = CHORUSES.filter((p) => !p.if || p.if(c)).map((p) => ({
    x: fill(p.x, c, rng, usedC), y: fill(p.y, c, rng, usedC), turn: fill(p.turn, c, rng, usedC),
  })).find((p) => [p.x, p.y, p.turn].every((f) => f && !lineProblems(f.lyric).length));
  const X = pair?.x ?? { lyric: 'Sing it, sing it loud! >> Hooray!', who: 'L' };
  const Y = pair?.y ?? { lyric: '[And] Sing it to the crowd >> Yay!', who: 'L' };
  const turn = pair?.turn ?? { lyric: 'Sing it, and be proud >> Hooray!', who: 'G' };
  const choir = c.choir.filter((n) => n !== c.L);
  const together = (who) => [...new Set([...choir.slice(0, 1), who === 'G' ? c.L : c.G])].filter((n) => n && n !== singerOf(who));
  const chorus = (last) => [
    { lyric: hook, singer: c.L, with: together('L') },
    { lyric: X.lyric, singer: singerOf(X.who), with: together(X.who) },
    { lyric: hook, singer: c.L, with: together('L') },
    { lyric: last.lyric, singer: singerOf(last.who), with: together(last.who) },
  ];
  out.chorus1 = chorus(Y);
  out.chorus2 = chorus(Y);
  out.chorus3 = chorus(turn);
  const title = hookLine.replace(/[!.?]+$/, '').replace(/\b([a-z])/g, (m) => m.toUpperCase());
  return { title, hook, sections: out };
}

/** Catchphrases sung as Soothing Bots sings them where the cast data's wording trips the voice engine ("has"). */
const SUNG_CATCHPHRASE = { Ray: "This one's got potential" };

/** A cast member's catchphrase as sung, with its punctuation ("That is extra!", "Who wants a surprise?"). */
export function catchphrase(name) {
  const s = String(SUNG_CATCHPHRASE[name] ?? CAST[name]?.says ?? '').trim().replace(/[.!?…]+$/, '');
  if (!s) return null;
  return `${s}${/^(who|what|why|how|is|are|can|do|does|really)\b/i.test(s) && !/wow$/i.test(s) ? '?' : '!'}`;
}
