/**
 * Task generation.
 *
 * The brief asks for "very specific revision tasks" rather than a generic
 * "revise X". Each checklist item therefore names the topic, states a concrete
 * artefact to produce, and carries a time box.
 */

/** Deterministic small hash so a topic always gets the same task variants. */
function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pick(list, seed) {
  return list[seed % list.length];
}

const LEARN_TASKS = [
  (t) => `Read your notes on ${t} once, then close them and rewrite the main idea from memory`,
  (t) => `Build a one-page map of ${t}: key terms in the middle, links out to sub-ideas`,
  (t) => `Split ${t} into 4–6 chunks and write a one-line summary of each`,
];

const LEARN_SECOND = [
  (t) => `Write 5 questions about ${t} you cannot yet answer`,
  (t) => `List the 3 terms in ${t} you would struggle to define out loud`,
  (t) => `Mark the parts of ${t} your notes skip over entirely`,
];

const RECALL_TASKS = [
  (t) => `Blank-page recall: write everything you remember about ${t} with notes closed`,
  (t) => `Cover your notes and explain ${t} out loud in 3 minutes, then check what you missed`,
  (t) => `Redraw your ${t} map from memory, then compare it with the original`,
];

const RECALL_SECOND = [
  (t) => `Do 10 practice questions on ${t} and log every error with its cause`,
  (t) => `Work 3 past-paper / interview-style questions on ${t} under a timer`,
  (t) => `Answer the 5 questions you wrote in session 1 on ${t}`,
];

const CONSOLIDATE_TASKS = [
  (t) => `Teach ${t} aloud for 5 minutes as if to someone who has never seen it`,
  (t) => `Write a one-page cheat sheet for ${t} from memory, then fill the gaps in red`,
  (t) => `Explain how ${t} connects to the other topics in this subject`,
];

const CONSOLIDATE_SECOND = [
  (t) => `Timed set: 15 minutes of mixed ${t} questions, no notes`,
  (t) => `Re-attempt every question on ${t} you previously got wrong`,
  (t) => `Attempt the hardest ${t} question you can find and narrate your reasoning`,
];

const REFLECT_TASK = (t) => `Rate your confidence in ${t} out of 5 and write one line on what is still shaky`;

/**
 * Build the day's checklist.
 *
 * @param {object} session `{ subject, topic, difficulty, repIndex, repCount }`
 * @returns {Array<{id: string, text: string, minutes: number}>}
 */
export function buildTasks({ subject, topic, difficulty = 'medium', repIndex = 0, repCount = 3 }) {
  const seed = hash(`${subject}|${topic}`);
  const label = topic;
  const isFinal = repIndex === repCount - 1;

  let items;
  if (repIndex === 0) {
    items = [
      { text: pick(LEARN_TASKS, seed)(label), minutes: 25 },
      { text: pick(LEARN_SECOND, seed + 1)(label), minutes: 10 },
    ];
  } else if (isFinal) {
    items = [
      { text: pick(CONSOLIDATE_TASKS, seed + 2)(label), minutes: 20 },
      { text: pick(CONSOLIDATE_SECOND, seed + 3)(label), minutes: 20 },
    ];
  } else {
    items = [
      { text: pick(RECALL_TASKS, seed + 4)(label), minutes: 15 },
      { text: pick(RECALL_SECOND, seed + 5)(label), minutes: 25 },
    ];
  }

  // Hard topics get an extra error-hunting pass; easy topics stay light.
  if (difficulty === 'hard' && repIndex > 0) {
    items.push({ text: `Review your error log for ${label} and redo the two worst mistakes`, minutes: 10 });
  }

  items.push({ text: REFLECT_TASK(label), minutes: 2 });

  return items.map((item, i) => ({
    id: `t${i}`,
    text: item.text,
    minutes: item.minutes,
  }));
}

/** Tighter, higher-intensity checklist for cram sessions. */
export function buildCramTasks({ topic, repIndex = 0, isFinalPass = false }) {
  const items = [];
  if (repIndex === 0) {
    items.push({ text: `Skim ${topic} for 8 minutes, then write the 5 facts most likely to be tested`, minutes: 12 });
    items.push({ text: `Active recall: cover notes, list everything you remember about ${topic}`, minutes: 10 });
    items.push({ text: `Timed practice: 5 quick questions on ${topic}`, minutes: 10 });
  } else if (isFinalPass) {
    items.push({ text: `Final active recall on ${topic} — say it out loud, no notes`, minutes: 8 });
    items.push({ text: `Error review: re-do the ${topic} questions you got wrong earlier`, minutes: 12 });
    items.push({ text: `Read your ${topic} cheat sheet one last time`, minutes: 5 });
  } else {
    items.push({ text: `Active recall on ${topic} from a blank page`, minutes: 10 });
    items.push({ text: `Timed practice: 8 questions on ${topic}`, minutes: 15 });
    items.push({ text: `Error review: log what you missed and why`, minutes: 5 });
  }
  return items.map((item, i) => ({ id: `c${i}`, text: item.text, minutes: item.minutes }));
}
