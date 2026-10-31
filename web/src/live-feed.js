// A director run as the LIVE making-of hears it (making-of.js start; the dev server's scripts/director/live.js). The
// stream (events.ndjson) is in beat order: the turnstile holds an event written for a later beat until that beat opens,
// so a host's reply to a question can land minutes after it was written. A recorded making-of knows when each event
// was written (its activity log: activity-lines.js writtenTimes) and sings it from then; live, the run's queue
// (queued.ndjson: what is written and not landed yet) tells the same, and so the live score sings the real work as it
// is written, by the same rules: the host's reply right after the question when it is there, a hold line and a recall
// when it comes later, one question on hold at a time. Each poll gives a snapshot:
//   { events (landed so far, in seq order), queued (written ahead: emit.js state.queue, each with `n` its call and `t`
//     when it was written), activity (the production's activity log so far: activity.js liveActivity) }
// and update(snapshot, now) feeds the score what is new: an event written ahead as it is heard (its own seq is not
// known yet: a provisional one between the landed seqs, in the order sent), its landing (the same event in the
// stream, matched by its content) as land(), the activity as the score's work lines. Pure; node tests drive it.
import { activityLines } from './activity-lines.js';

/** An event's identity across the queue and the stream (the queue's copy has no seq, no `t` of its landing). */
const keyOf = (e) => JSON.stringify([e.agent, e.bot, e.beat, e.move ?? '', e.thread ?? '', e.summary ?? '', e.lyric ?? '']);

export class LiveFeed {
  /** score: a MakingOfScore({ live: true }). */
  constructor(score) {
    this.score = score;
    this.seen = 0; //            landed events taken from the stream so far
    this.byKey = new Map(); //   key -> [provisional seq, ...] heard ahead, not landed yet (first in, first out)
    this.heard = new Set(); //   queue entries heard (`n|key|k`)
    this.made = 0; //            provisional seqs given
    this.actCount = -1;
    this.lyricBeats = new Set(); // beats with a line of Green's known (landed or queued)
    this.plainBeats = new Set(); // beats whose first plain event is known
  }

  /** The snapshot's news, fed to the score; returns the staged events it lays out (timed, in order). */
  update({ events = [], queued = [], activity = null } = {}, now = 0) {
    const s = this.score;
    const fresh = [], landing = [];
    for (const e of [...events, ...queued]) if (e.lyric) this.lyricBeats.add(e.beat);
    // the stream: what lands; one heard ahead lands now (its beat opens), the rest is new
    for (const e of events.slice(this.seen)) {
      const list = this.byKey.get(keyOf(e));
      if (list?.length) { landing.push(list.shift()); continue; }
      if (!e.move) this.plainBeats.add(e.beat);
      fresh.push(e);
    }
    this.seen = Math.max(this.seen, events.length);
    // the queue: what is written ahead, heard once (in the order sent)
    const k = new Map();
    for (const q of queued) {
      const key = keyOf(q);
      const id = `${q.n}|${key}`;
      const nth = k.get(id) ?? 0;
      k.set(id, nth + 1);
      const hid = `${id}|${nth}`;
      if (this.heard.has(hid)) continue;
      // (as a recorded making-of: Green's lines are sung when they land, they open their beat's section; so is the
      // first plain event of a beat with no line of Green's known yet, a chorus sung again)
      if (q.lyric) continue;
      if (!q.move && !this.plainBeats.has(q.beat) && !this.lyricBeats.has(q.beat)) continue;
      this.heard.add(hid);
      if (!q.move) this.plainBeats.add(q.beat);
      // (between the landed seqs and the next to land, in the order heard: a thread's moves keep their order)
      const seq = +(this.seen - 0.5 + ++this.made * 1e-6).toFixed(6);
      const { n, ...e } = q;
      fresh.push({ ...e, seq, t: Number.isFinite(q.t) ? Math.min(q.t, now) : now, ahead: true });
      if (!this.byKey.has(key)) this.byKey.set(key, []);
      this.byKey.get(key).push(seq);
    }
    // the activity log: the production's real work, sung where nobody has news
    if (Array.isArray(activity) && activity.length !== this.actCount) {
      this.actCount = activity.length;
      s.setActs(activityLines(activity));
    }
    const out = [];
    if (landing.length) out.push(...s.land(landing, now));
    out.push(...s.add(fresh, now));
    return out.sort((a, b) => a.t - b.t);
  }
}

/**
 * A recorded run as the dev server would have shown it at `t` (s since the production started): the events landed by
 * then, the ones written ahead and not landed (activity.ndjson's `queue` entries: when each was sent), the activity
 * so far. For tests and rehearsals of the live path on a checked-in bundle.
 */
export function snapshotAt({ events, activity = null }, t) {
  const landed = events.filter((e) => (Number(e.t) || 0) <= t + 1e-9).sort((a, b) => a.seq - b.seq);
  const queued = [];
  for (const [i, a] of (activity ?? []).entries()) {
    if (a?.kind !== 'queue' || !Array.isArray(a.seqs) || a.t > t + 1e-9) continue;
    for (const seq of a.seqs) {
      const e = events.find((x) => x.seq === seq);
      if (!e || (Number(e.t) || 0) <= t + 1e-9) continue;
      const { seq: _s, t: _t, answers: _a, ...rest } = e;
      queued.push({ ...rest, n: i, t: a.t });
    }
  }
  return { events: landed, queued, activity: activity ? activity.filter((a) => a.t <= t + 1e-9) : null };
}
