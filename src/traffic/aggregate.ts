export type TrafficEvent = {
  id: string;
  visitor_id: string;
  session_id: string | null;
  event_type: string;
  page_url: string | null;
  created_at: Date | string;
};

type Session = { steps: string[]; converted: boolean; lastSeen: number };
const INACTIVITY_MS = 30 * 60 * 1000;
const GOAL = 'xaylo:conversion';

/** Transform a location's ordered events into the dartboard's mutually exclusive path cohorts. */
export function buildTrafficDataset(events: TrafficEvent[], days = 30) {
  const sessions = new Map<string, Session>();
  const current = new Map<string, { key: string; lastSeen: number; sequence: number }>();
  const pages = new Map<string, { id: string; label: string; icon: string; isEntry?: boolean }>();

  for (const event of events) {
    const time = new Date(event.created_at).getTime();
    if (!Number.isFinite(time) || !event.page_url || !['page_view', 'conversion'].includes(event.event_type)) continue;
    let url: URL;
    try { url = new URL(event.page_url); } catch { continue; }
    const pageId = `${url.origin}${url.pathname}`;
    const root = event.session_id ? `${event.visitor_id}:${event.session_id}` : `legacy:${event.visitor_id}`;
    const previous = current.get(root);
    const sequence = previous && time - previous.lastSeen <= INACTIVITY_MS ? previous.sequence : (previous?.sequence ?? -1) + 1;
    const key = `${root}:${sequence}`;
    current.set(root, { key, lastSeen: time, sequence });
    const session = sessions.get(key) ?? { steps: [], converted: false, lastSeen: time };
    if (session.converted) continue;
    if (!pages.has(pageId)) pages.set(pageId, { id: pageId, label: `${url.host}${url.pathname}`, icon: '◉' });
    if (!session.steps.length) pages.get(pageId)!.isEntry = true;
    if (event.event_type === 'page_view' || session.steps.at(-1) !== pageId) session.steps.push(pageId);
    if (event.event_type === 'conversion') { session.steps.push(GOAL); session.converted = true; }
    session.lastSeen = time;
    sessions.set(key, session);
  }

  const cohorts = new Map<string, { steps: string[]; sessions: number }>();
  for (const session of sessions.values()) {
    if (!session.steps.length) continue;
    const key = JSON.stringify(session.steps);
    const cohort = cohorts.get(key);
    if (cohort) cohort.sessions++;
    else cohorts.set(key, { steps: session.steps, sessions: 1 });
  }
  return {
    period: `Last ${days} days`, defaultGoal: GOAL,
    pages: [...pages.values(), { id: GOAL, label: 'Conversion', icon: '🎯', isConversion: true }],
    paths: [...cohorts.values()].sort((a, b) => b.sessions - a.sessions)
  };
}
