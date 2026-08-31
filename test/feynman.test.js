import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyseExplanation,
  childQuestions,
  findCircular,
  findJargon,
  readingGrade,
  verbatimOverlap,
} from '../src/core/feynman.js';

const NOTES = `Photosynthesis
Photosynthesis is the process by which plants convert light energy into chemical energy.
- Light-dependent reactions occur in the thylakoid membrane
- Photolysis splits water to release oxygen
- The Calvin cycle fixes carbon using RuBisCO
- ATP and NADPH are produced`;

const RECITED =
  'Photosynthesis is the process by which plants convert light energy into chemical energy. ' +
  'Light-dependent reactions occur in the thylakoid membrane. Photolysis splits water to release oxygen. ' +
  'The Calvin cycle fixes carbon using RuBisCO.';

const OWN_WORDS =
  'Plants basically run on sunlight. They catch light with a green pigment and use that energy to rip apart water, ' +
  'which is where the oxygen we breathe comes from. That gives them a chemical battery, and they spend it building ' +
  'sugar out of carbon dioxide from the air. It is like charging a power bank in the day and using it to build ' +
  'things, because the building part does not need light itself.';

test('an explanation in your own words beats one copied from your notes', () => {
  const recited = analyseExplanation(RECITED, { notes: NOTES, topic: 'Photosynthesis' });
  const own = analyseExplanation(OWN_WORDS, { notes: NOTES, topic: 'Photosynthesis' });

  assert.ok(own.score > recited.score + 20, `own=${own.score} should clearly beat recited=${recited.score}`);
  assert.ok(recited.overlapRatio > 40, `recital should be detected, got ${recited.overlapRatio}%`);
  assert.equal(own.overlapRatio, 0, 'reworded text should not register as copied');
  assert.match(recited.improvements[0].title, /reciting/i, 'and it should be the headline problem');
});

test('verbatim overlap catches a lifted clause but not shared vocabulary', () => {
  const lifted = verbatimOverlap('The Calvin cycle fixes carbon using RuBisCO in the stroma', NOTES);
  assert.ok(lifted.ratio > 0.3, `expected a high ratio, got ${lifted.ratio}`);

  const sameTopicDifferentWords = verbatimOverlap(
    'Plants build sugar from air using energy they captured from sunlight earlier',
    NOTES,
  );
  assert.equal(sameTopicDifferentWords.ratio, 0);

  assert.deepEqual(verbatimOverlap('anything at all here', ''), { ratio: 0, matched: [] });
});

test('jargon is a term used but never unpacked', () => {
  const used = findJargon('Photolysis is the key step that everything depends on.', ['photolysis']);
  assert.deepEqual(used, ['photolysis'], 'naming it is not explaining it');

  const unpacked = findJargon(
    'Photolysis means splitting water apart with light, which is where the oxygen comes from.',
    ['photolysis'],
  );
  assert.deepEqual(unpacked, [], 'a definitional cue counts as unpacking it');

  assert.deepEqual(findJargon('No such word appears here at all.', ['photolysis']), []);
});

test('ordinary words are not mistaken for jargon', () => {
  const analysis = analyseExplanation(RECITED, { notes: NOTES, topic: 'Photosynthesis' });
  for (const word of ['occur', 'fixes', 'carbon', 'cycle', 'light', 'energy']) {
    assert.ok(!analysis.jargon.includes(word), `"${word}" is an ordinary word, not jargon`);
  }
  // The genuinely technical ones are still caught.
  assert.ok(analysis.jargon.includes('photolysis'));
});

test('circular definitions are caught', () => {
  assert.equal(findCircular('Photosynthesis is when photosynthesis happens in a plant.').length, 1);
  assert.equal(findCircular('Photosynthesis is how plants turn light into food.').length, 0);
});

test('reading grade rises with longer words and sentences', () => {
  const plain = readingGrade('Plants use light to make food. They take in air and water. The light gives them energy.');
  const dense =
    readingGrade('The photosynthetic apparatus facilitates the transduction of electromagnetic radiation into ' +
      'chemical potential energy via a series of oxidation-reduction reactions occurring within specialised organelles.');
  assert.ok(plain < dense, `plain=${plain} should be below dense=${dense}`);
  assert.ok(plain < 9, 'plain language should land in Feynman territory');
  assert.equal(readingGrade(''), 0);
});

test('a short explanation is refused rather than scored', () => {
  const result = analyseExplanation('It is about plants and light.', { notes: NOTES, topic: 'Photosynthesis' });
  assert.equal(result.ok, false);
  assert.equal(result.tooShort, true);
  assert.match(result.message, /too short/i);
});

test('scoring is capped when there are no notes to check against', () => {
  const withNotes = analyseExplanation(OWN_WORDS, { notes: NOTES, topic: 'Photosynthesis' });
  const without = analyseExplanation(OWN_WORDS, { topic: 'Photosynthesis' });

  assert.equal(withNotes.verified, true);
  assert.equal(without.verified, false);
  assert.ok(without.score <= 85, 'an unverifiable score must not claim certainty');
  assert.ok(withNotes.score > without.score, 'verification is what earns the top of the range');
  assert.match(without.verdict, /unverified/i);
});

test('the analysis returns questions, never answers', () => {
  const analysis = analyseExplanation(RECITED, { notes: NOTES, topic: 'Photosynthesis' });

  assert.ok(analysis.questions.length >= 3);
  for (const q of analysis.questions) {
    assert.ok(q.trim().endsWith('?'), `"${q}" should be a question`);
  }
  // Nothing in the feedback should assert subject facts back at the learner.
  const feedback = analysis.improvements.map((i) => `${i.title} ${i.detail}`).join(' ');
  assert.ok(!/the answer is/i.test(feedback));
});

test('missing concepts are drawn from the notes, but the topic name is not one', () => {
  const analysis = analyseExplanation(OWN_WORDS, { notes: NOTES, topic: 'Photosynthesis' });
  assert.ok(!analysis.missingTerms.includes('photosynthesis'), 'the topic name is not a missing concept');
  assert.ok(analysis.missingTerms.length > 0, 'genuinely unmentioned concepts are still reported');
});

test('analogies and causal reasoning are credited', () => {
  const analysis = analyseExplanation(OWN_WORDS, { notes: NOTES, topic: 'Photosynthesis' });
  assert.ok(analysis.analogies.length > 0, '"it is like charging a power bank" is an analogy');
  assert.ok(analysis.reasoningDensity > 0, '"because" is causal reasoning');
  assert.ok(analysis.strengths.some((s) => /analogy/i.test(s)));
});

test('hedging is surfaced as a map of what to review', () => {
  const hedged =
    'It is sort of about plants making food somehow. I think the light does something to the water, and maybe ' +
    'that produces oxygen or something like that. I guess the sugar comes from the air, probably.';
  const analysis = analyseExplanation(hedged, { notes: NOTES, topic: 'Photosynthesis' });

  assert.ok(analysis.hedges.length >= 2);
  assert.ok(analysis.improvements.some((i) => /hedge/i.test(i.title)));
  assert.ok(analysis.score < 70, 'hedging throughout should not score well');
});

test('childQuestions targets the specific weaknesses found', () => {
  const questions = childQuestions({
    jargon: ['photolysis'],
    missingTerms: ['rubisco'],
    topic: 'Photosynthesis',
    reasoningDensity: 0,
    analogies: [],
  });

  assert.ok(questions.some((q) => q.includes('photolysis')), 'asks about the unexplained term');
  assert.ok(questions.some((q) => q.includes('rubisco')), 'asks about the skipped concept');
  assert.ok(questions.every((q) => q.endsWith('?')));
  assert.ok(questions.length <= 6, 'a manageable number, not a wall');
});

test('handles empty and missing input without throwing', () => {
  for (const input of ['', null, undefined, '   ']) {
    const result = analyseExplanation(input, { notes: NOTES, topic: 'X' });
    assert.equal(result.ok, false);
    assert.equal(result.tooShort, true);
  }
});
