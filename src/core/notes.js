/**
 * Study Buddy — note parsing, structuring and comparison.
 *
 * The app cannot invent facts it has not been given, and pretending otherwise
 * would produce confident-sounding nonsense in a study tool. So instead of
 * fabricating content, it does something more useful: it holds the learner's
 * notes against the structure that *complete* notes on any topic have, shows
 * which slots are filled, which are empty, and what belongs in the empty ones.
 *
 * Column A = the learner's notes, as written.
 * Column B = the same material reorganised into that structure, with the
 *            missing slots called out as prompts rather than invented answers.
 */

const STOPWORDS = new Set(
  ('a an and are as at be been being but by can could do does for from had has have how i if in into is it its may might must ' +
    'not of on or should so some such than that the their them then there these they this those to too us was we were what when ' +
    'where which who why will with would you your it\'s also more most very just about between during each other over under').split(' '),
);

/**
 * The skeleton of well-formed study notes. `cues` are the surface signals that
 * suggest a learner has already covered that slot.
 */
export const NOTE_SECTIONS = [
  {
    key: 'definition',
    title: 'Definition & scope',
    prompt: 'A one-sentence definition in your own words, plus what this topic does NOT cover.',
    cues: [/\bis\s+(a|an|the)\b/i, /\bdefin/i, /\bmeans\b/i, /\brefers?\s+to\b/i, /\bknown as\b/i, /:\s*\S/],
  },
  {
    key: 'concepts',
    title: 'Key concepts & terminology',
    prompt: 'The 5–8 terms you must be able to define cold. One line each.',
    cues: [/\bterm/i, /\bconcept/i, /\bkey\b/i, /\bvocab/i, /^[-*•]\s/m],
  },
  {
    key: 'mechanism',
    title: 'How it works — steps or mechanism',
    prompt: 'The process, derivation, or causal chain, written as ordered steps.',
    cues: [/\bstep\b/i, /\bprocess\b/i, /\bfirst\b/i, /\bthen\b/i, /\bstage/i, /\bmechanis/i, /^\s*\d+[.)]\s/m, /\bbecause\b/i, /→|->/],
  },
  {
    key: 'examples',
    title: 'Worked examples',
    prompt: 'At least one fully worked example, and one edge case that breaks the naive approach.',
    cues: [/\bexample/i, /\be\.g\./i, /\bfor instance\b/i, /\bsuppose\b/i, /\bworked\b/i, /\bcase study\b/i],
  },
  {
    key: 'contrasts',
    title: 'Comparisons & distinctions',
    prompt: 'What this is often confused with, and the single test that tells them apart.',
    cues: [/\bversus\b/i, /\bvs\.?\b/i, /\bcompar/i, /\bdiffer/i, /\bunlike\b/i, /\bwhereas\b/i, /\bcontrast/i],
  },
  {
    key: 'pitfalls',
    title: 'Common pitfalls & misconceptions',
    prompt: 'The mistakes people reliably make here — including the ones you have made.',
    cues: [/\bmistake/i, /\bpitfall/i, /\bmisconcep/i, /\bconfus/i, /\bcareful\b/i, /\bwatch out\b/i, /\bcommon error/i, /\bdon'?t forget\b/i],
  },
  {
    key: 'application',
    title: 'Exam / interview angles',
    prompt: 'How this actually gets asked: question stems, mark-scheme phrases, follow-up probes.',
    // `\bexam` alone would match "example" — which belongs to the examples slot,
    // not this one. Anchor the whole word instead.
    cues: [/\bexams?\b/i, /\bexamin/i, /\bquestion/i, /\bmarks?\b/i, /\basked\b/i, /\binterview/i, /\bpast paper/i, /\btested\b/i],
  },
  {
    key: 'links',
    title: 'Links to other topics',
    prompt: 'What this depends on, and what depends on it. Isolated facts are forgotten facts.',
    cues: [/\brelated\b/i, /\bconnect/i, /\bdepends?\s+on\b/i, /\bbuilds?\s+on\b/i, /\bsee also\b/i, /\blinks?\s+to\b/i, /\bleads?\s+to\b/i],
  },
];

/**
 * Split raw notes into headings, bullets and sentences.
 * Understands markdown-ish headings (`# x`, `x:`) and bullets (`-`, `*`, `1.`).
 */
export function parseNotes(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n').map((l) => l.trim());

  const sections = [];
  let current = { heading: null, lines: [] };

  const isHeading = (line) =>
    /^#{1,6}\s+\S/.test(line) ||
    (/^[^\s].{0,60}:$/.test(line) && !/^[-*•\d]/.test(line)) ||
    (/^[A-Z][A-Za-z0-9 ,/&'()-]{2,50}$/.test(line) && line.split(' ').length <= 7 && !/[.?!]$/.test(line));

  for (const line of lines) {
    if (!line) continue;
    if (isHeading(line)) {
      if (current.heading || current.lines.length) sections.push(current);
      current = { heading: line.replace(/^#{1,6}\s+/, '').replace(/:$/, ''), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading || current.lines.length) sections.push(current);

  const bullets = lines.filter((l) => /^([-*•]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''));
  const sentences = text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  const words = text.split(/\s+/).filter(Boolean);

  return {
    text,
    lines,
    sections,
    bullets,
    sentences,
    wordCount: words.length,
    headings: sections.map((s) => s.heading).filter(Boolean),
    isEmpty: text.length === 0,
  };
}

/** Candidate key terms: frequent content words plus explicitly defined ones. */
export function extractTerms(parsed, limit = 12) {
  const counts = new Map();
  const bump = (term, by = 1) => {
    const key = term.toLowerCase();
    if (key.length < 3 || STOPWORDS.has(key) || /^\d+$/.test(key)) return;
    counts.set(key, (counts.get(key) || 0) + by);
  };

  for (const word of parsed.text.split(/[^A-Za-z0-9'-]+/)) {
    if (word) bump(word);
  }

  // Terms the learner explicitly defined carry more weight.
  for (const line of parsed.lines) {
    const defined = line.match(/^([A-Za-z][A-Za-z0-9 '-]{1,40})\s*[:—-]\s+\S/);
    if (defined) bump(defined[1].trim(), 6);
    const isA = line.match(/^([A-Za-z][A-Za-z0-9 '-]{1,40})\s+(is|are|means|refers to)\b/i);
    if (isA) bump(isA[1].trim(), 5);
    for (const bold of line.matchAll(/\*\*(.+?)\*\*/g)) bump(bold[1].trim(), 4);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, weight]) => ({ term, weight }));
}

/** Which structural slots the notes already cover, and with what evidence. */
export function assessCoverage(parsed) {
  return NOTE_SECTIONS.map((section) => {
    const evidence = [];
    for (const line of parsed.lines) {
      if (section.cues.some((cue) => cue.test(line))) {
        evidence.push(line);
        if (evidence.length >= 3) break;
      }
    }
    // A heading that names the slot counts as strong evidence.
    const headingMatch = parsed.headings.find((h) =>
      section.cues.some((cue) => cue.test(h)) || h.toLowerCase().includes(section.key),
    );
    const covered = evidence.length > 0 || Boolean(headingMatch);
    return {
      ...section,
      covered,
      strength: headingMatch ? 'strong' : evidence.length >= 2 ? 'partial' : evidence.length ? 'weak' : 'missing',
      evidence,
    };
  });
}

/**
 * Build the side-by-side comparison.
 *
 * @param {string} userNotes Raw notes from the learner.
 * @param {object} meta      `{ subject, topic }`
 */
export function compareNotes(userNotes, { subject = '', topic = 'this topic' } = {}) {
  const parsed = parseNotes(userNotes);
  const coverage = assessCoverage(parsed);
  const terms = extractTerms(parsed);

  const structured = coverage.map((section) => ({
    key: section.key,
    title: section.title,
    covered: section.covered,
    strength: section.strength,
    // Column B: the learner's own lines, filed under the right heading.
    content: section.evidence,
    // Where nothing was found, say what belongs there — do not invent facts.
    prompt: section.prompt,
  }));

  const missing = coverage.filter((s) => !s.covered);
  const strong = coverage.filter((s) => s.strength === 'strong' || s.strength === 'partial');

  const strengths = [];
  if (parsed.headings.length >= 3) {
    strengths.push(`Your notes are already structured — ${parsed.headings.length} headings makes them reviewable, not just readable.`);
  }
  if (parsed.bullets.length >= 5) {
    strengths.push(`${parsed.bullets.length} bullet points: good chunking. Chunked notes are far easier to self-test from than prose.`);
  }
  for (const section of strong.slice(0, 3)) {
    strengths.push(`"${section.title}" is covered — that is one of the slots most people skip.`);
  }
  if (terms.length >= 6) {
    strengths.push(`You have ${terms.length}+ recurring technical terms, so the vocabulary base is there.`);
  }
  if (!strengths.length && parsed.wordCount > 0) {
    strengths.push('You have made a start — that is worth more than a blank page. Now we give it a shape.');
  }

  const gaps = missing.map((section) => ({
    title: section.title,
    why: section.prompt,
  }));

  const suggestions = [];
  if (!coverage.find((s) => s.key === 'examples').covered) {
    suggestions.push(`Add one fully worked example for ${topic}. Notes without examples fail the moment a question is phrased differently.`);
  }
  if (!coverage.find((s) => s.key === 'pitfalls').covered) {
    suggestions.push('Start an error log at the bottom of these notes. Every question you get wrong goes there, with the reason — not just the correction.');
  }
  if (parsed.bullets.length === 0 && parsed.wordCount > 60) {
    suggestions.push('Break the prose into bullets. You cannot self-test against a paragraph, but you can cover a bullet and try to recall it.');
  }
  if (parsed.wordCount < 60 && parsed.wordCount > 0) {
    suggestions.push(`These notes are short (${parsed.wordCount} words). Before the next session, expand the part of ${topic} you understand least — writing is where the gaps show up.`);
  }
  if (!coverage.find((s) => s.key === 'application').covered) {
    suggestions.push('Write down 3 question stems that examiners or interviewers actually use for this topic, then answer one from memory.');
  }
  if (terms.length) {
    suggestions.push(`Cover the page and define these from memory: ${terms.slice(0, 5).map((t) => t.term).join(', ')}.`);
  }

  return {
    subject,
    topic,
    parsed,
    terms,
    coverage,
    structured,
    strengths,
    gaps,
    suggestions,
    coverageScore: Math.round((coverage.filter((s) => s.covered).length / coverage.length) * 100),
    weakest: missing.slice(0, 3).map((s) => s.title),
  };
}

/**
 * Learn Mode: a step-by-step walkthrough built from the learner's own material.
 * Every step ends in a question — the learner does the thinking, not the app.
 */
export function buildLearnMode(comparison) {
  const { topic, terms, coverage, parsed } = comparison;
  const steps = [];

  steps.push({
    title: 'Step 1 — Anchor the idea',
    body: `Before any detail: in one sentence, what is ${topic} for? What problem does it solve or what question does it answer?`,
    analogy: `If you had to explain ${topic} to a smart 12-year-old with no jargon at all, what everyday thing would you compare it to?`,
    check: `Write your one-sentence version of ${topic} now, then compare it with the definition in your notes. Which is clearer?`,
  });

  if (terms.length) {
    steps.push({
      title: 'Step 2 — Lock the vocabulary',
      body: `These recur through your notes: ${terms.slice(0, 6).map((t) => t.term).join(', ')}. Precise terms are what let you reason quickly under pressure.`,
      analogy: 'Vocabulary is the handle on a concept — without it you have to describe the whole thing every time you want to pick it up.',
      check: 'Cover your notes. Define each term out loud. Any you stumble on gets a star and its own review slot.',
    });
  }

  const mechanism = coverage.find((s) => s.key === 'mechanism');
  steps.push({
    title: `Step ${steps.length + 1} — Trace the mechanism`,
    body: mechanism.covered
      ? `Your notes describe the process. Walk it end to end and, at each step, ask: what would break if this step were removed?`
      : `Your notes do not yet lay out how ${topic} actually works step by step. Build that chain now — it is the difference between recognising the topic and being able to use it.`,
    analogy: 'A mechanism you can only recite is a script; one you can perturb is understanding.',
    check: 'Explain the process without looking. Where did you hesitate? That hesitation is the exact place to review.',
  });

  const examples = coverage.find((s) => s.key === 'examples');
  steps.push({
    title: `Step ${steps.length + 1} — Ground it in an example`,
    body: examples.covered
      ? 'Take the example from your notes and change one variable. Does your explanation still hold?'
      : `Find or build one concrete example of ${topic}. Abstract-only understanding collapses under exam conditions.`,
    analogy: 'An example is a handrail: you can follow the abstraction without it, but not when you are tired and rushed.',
    check: 'Construct a second example that is superficially different but structurally the same. What stayed constant?',
  });

  steps.push({
    title: `Step ${steps.length + 1} — Stress-test it`,
    body: `Where does ${topic} stop applying? Every real concept has boundaries, and questions love to sit right on them.`,
    analogy: 'Knowing the edge of the map matters as much as knowing the middle.',
    check: 'Name one situation where applying this would be a mistake, and say why.',
  });

  steps.push({
    title: `Step ${steps.length + 1} — Teach it back`,
    body: `Explain ${topic} out loud for three minutes, unaided. ${parsed.isEmpty ? 'Do this even without notes — the gaps you hit tell you what to write down.' : 'Then reread your notes and mark everything you left out.'}`,
    analogy: 'Teaching is the only self-test that cannot be faked — you notice the exact second you run out of understanding.',
    check: 'What did you skip or hand-wave? That goes on tomorrow\'s checklist.',
  });

  return {
    topic,
    steps,
    reflection: [
      `What was the hardest part of ${topic} today?`,
      'What is one thing you understand now that you did not an hour ago?',
      'What would you need to see one more time to feel confident?',
    ],
  };
}
