/**
 * Application state: subjects, topics, per-task progress, notes and settings.
 * Persisted to localStorage, with a tiny subscribe/notify loop driving re-render.
 */

import { fromISODate, toISODate } from '../core/dates.js';
import { DEFAULT_DIFFICULTY } from '../core/scheduler.js';

const STORAGE_KEY = 'study-buddy:v1';

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];

let uid = 0;
function makeId(prefix) {
  uid += 1;
  return `${prefix}_${Date.now().toString(36)}_${uid.toString(36)}`;
}

function defaultState() {
  return {
    version: 1,
    settings: {
      startDate: toISODate(new Date()),
      horizonDays: 126,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: '18:00',
    },
    subjects: [],
    topics: [],
    progress: {},
    notes: {},
    cram: { topicIds: [], testDate: '', testTime: '09:00' },
    planView: 'calendar',
    tab: 'overview',
  };
}

let state = defaultState();
const listeners = new Set();

/* ------------------------------------------------------------ lifecycle -- */

export function load() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...(parsed.settings || {}) } };
      migrate(state);
    }
  } catch {
    // Corrupt or unavailable storage: fall back to a clean slate rather than
    // failing to boot. The learner's plan is regenerable from subjects/topics.
    state = defaultState();
  }
  return state;
}

/**
 * Bring older saved state up to date. Topics predating per-topic start dates
 * inherit the plan's original start, so an existing plan keeps exactly the
 * schedule its owner has been following rather than jumping.
 */
function migrate(s) {
  const fallback = s.settings.startDate || toISODate(new Date());
  for (const topic of s.topics) {
    if (!topic.startDate) topic.startDate = fallback;
  }
}

function persist() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — the session still works in memory */
  }
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function commit() {
  persist();
  for (const fn of listeners) fn(state);
}

/** Mutate state through a callback, then persist + notify once. */
export function update(mutator) {
  mutator(state);
  commit();
}

/**
 * Re-render without changing persisted state. Views keep some transient state
 * of their own (which question is showing, whether Learn Mode is open); this
 * is how they ask for a repaint after changing it.
 */
export function refresh() {
  for (const fn of listeners) fn(state);
}

/* -------------------------------------------------------------- queries -- */

export function subjectById(id) {
  return state.subjects.find((s) => s.id === id) || null;
}

/** Topics joined with their subject name, in display order. */
export function topicsWithSubject() {
  return state.topics.map((topic) => {
    const subject = subjectById(topic.subjectId);
    return {
      id: topic.id,
      subjectId: topic.subjectId,
      subject: subject ? subject.name : 'Unsorted',
      color: subject ? subject.color : '#64748b',
      topic: topic.topic,
      difficulty: topic.difficulty,
      startDate: topic.startDate ? fromISODate(topic.startDate) : null,
      startDateISO: topic.startDate || null,
    };
  });
}

export function topicsForSubject(subjectId) {
  return state.topics.filter((t) => t.subjectId === subjectId);
}

export function topicById(id) {
  return state.topics.find((t) => t.id === id) || null;
}

/* ------------------------------------------------------------ mutations -- */

export function addSubject(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const subject = {
    id: makeId('sub'),
    name: trimmed,
    color: PALETTE[state.subjects.length % PALETTE.length],
  };
  update((s) => s.subjects.push(subject));
  return subject;
}

export function renameSubject(id, name) {
  update((s) => {
    const subject = s.subjects.find((x) => x.id === id);
    if (subject && String(name).trim()) subject.name = String(name).trim();
  });
}

export function removeSubject(id) {
  update((s) => {
    s.subjects = s.subjects.filter((x) => x.id !== id);
    s.topics = s.topics.filter((t) => t.subjectId !== id);
  });
}

export function addTopic(subjectId, topicName, difficulty = DEFAULT_DIFFICULTY, startDate) {
  const trimmed = String(topicName || '').trim();
  if (!trimmed || !subjectId) return null;
  // Each topic remembers the day it was added and climbs the ladder from
  // there. Without this, a topic added weeks into a plan would be back-dated
  // to the plan's origin and land entirely in the past.
  const topic = {
    id: makeId('top'),
    subjectId,
    topic: trimmed,
    difficulty,
    startDate: startDate || toISODate(new Date()),
  };
  update((s) => s.topics.push(topic));
  return topic;
}

/** Accepts "Topic A, Topic B" or one topic per line. */
export function addTopicsBulk(subjectId, text, difficulty = DEFAULT_DIFFICULTY) {
  const names = String(text || '')
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const today = toISODate(new Date());
  const added = [];
  for (const name of names) {
    const topic = addTopic(subjectId, name, difficulty, today);
    if (topic) added.push(topic);
  }
  return added;
}

export function setTopicDifficulty(id, difficulty) {
  update((s) => {
    const topic = s.topics.find((t) => t.id === id);
    if (topic) topic.difficulty = difficulty;
  });
}

export function renameTopic(id, name) {
  update((s) => {
    const topic = s.topics.find((t) => t.id === id);
    if (topic && String(name).trim()) topic.topic = String(name).trim();
  });
}

export function removeTopic(id) {
  update((s) => {
    s.topics = s.topics.filter((t) => t.id !== id);
    delete s.notes[id];
  });
}

/** Move a topic up (-1) or down (+1) in the global study order. */
export function moveTopic(id, delta) {
  update((s) => {
    const index = s.topics.findIndex((t) => t.id === id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= s.topics.length) return;
    const [item] = s.topics.splice(index, 1);
    s.topics.splice(target, 0, item);
  });
}

/* ------------------------------------------------------------- progress -- */

export function isTaskDone(sessionId, taskId) {
  return Boolean(state.progress[sessionId]?.[taskId]);
}

export function toggleTask(sessionId, taskId) {
  update((s) => {
    if (!s.progress[sessionId]) s.progress[sessionId] = {};
    if (s.progress[sessionId][taskId]) delete s.progress[sessionId][taskId];
    else s.progress[sessionId][taskId] = true;
  });
}

/** Completion of one session, as a 0–100 percentage. */
export function sessionProgress(session) {
  const tasks = session.tasks || [];
  if (!tasks.length) return 0;
  const done = tasks.filter((t) => isTaskDone(session.id, t.id)).length;
  return Math.round((done / tasks.length) * 100);
}

/* ------------------------------------------------------------- settings -- */

export function updateSettings(patch) {
  update((s) => Object.assign(s.settings, patch));
}

export function setTab(tab) {
  update((s) => {
    s.tab = tab;
  });
}

export function setPlanView(view) {
  update((s) => {
    s.planView = view;
  });
}

/* ---------------------------------------------------------------- notes -- */

export function getNotes(topicId) {
  return state.notes[topicId] || '';
}

export function saveNotes(topicId, text) {
  update((s) => {
    s.notes[topicId] = text;
  });
}

/* ----------------------------------------------------------------- cram -- */

export function updateCram(patch) {
  update((s) => Object.assign(s.cram, patch));
}

export function toggleCramTopic(topicId) {
  update((s) => {
    const index = s.cram.topicIds.indexOf(topicId);
    if (index === -1) s.cram.topicIds.push(topicId);
    else s.cram.topicIds.splice(index, 1);
  });
}

/* ------------------------------------------------------------ seed/reset -- */

export function resetAll() {
  state = defaultState();
  commit();
}

/** A small worked example so the app is explorable before any data is entered. */
export function loadSample() {
  resetAll();
  const bio = addSubject('Biology');
  const math = addSubject('Maths');
  const interview = addSubject('Interview Prep');

  addTopic(bio.id, 'Photosynthesis', 'hard');
  addTopic(bio.id, 'Cell respiration', 'medium');
  addTopic(bio.id, 'Enzymes', 'easy');
  addTopic(math.id, 'Integration by parts', 'hard');
  addTopic(math.id, 'Binomial expansion', 'medium');
  addTopic(interview.id, 'SQL joins', 'hard');
  addTopic(interview.id, 'Behavioural questions (STAR)', 'medium');
}
