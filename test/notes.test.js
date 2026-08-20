import test from 'node:test';
import assert from 'node:assert/strict';

import { parseNotes, extractTerms, assessCoverage, compareNotes, buildLearnMode, NOTE_SECTIONS } from '../src/core/notes.js';

const RICH_NOTES = `# Photosynthesis

Definition
Photosynthesis is the process by which plants convert light energy into chemical energy.

Light-dependent reactions
- Occur in the thylakoid membrane
- Water is split (photolysis) to release oxygen
- ATP and NADPH are produced

Calvin cycle
1. Carbon fixation by RuBisCO
2. Then reduction of GP to TP
3. Regeneration of RuBP

Example
For instance, a plant in bright light saturates at a certain CO2 concentration.

Common mistakes
- Students confuse the Calvin cycle with the light-dependent reactions
- Careful: oxygen comes from water, not carbon dioxide`;

const THIN_NOTES = 'Photosynthesis makes food.';

test('parses headings, bullets and numbered steps', () => {
  const parsed = parseNotes(RICH_NOTES);

  assert.ok(parsed.headings.includes('Photosynthesis'));
  assert.ok(parsed.headings.includes('Calvin cycle'));
  assert.ok(parsed.bullets.length >= 5, 'picks up both - bullets and numbered steps');
  assert.ok(parsed.wordCount > 60);
  assert.equal(parsed.isEmpty, false);
});

test('handles empty and whitespace-only notes', () => {
  for (const input of ['', '   \n  \n', null, undefined]) {
    const parsed = parseNotes(input);
    assert.equal(parsed.isEmpty, true);
    assert.equal(parsed.wordCount, 0);
    assert.deepEqual(parsed.bullets, []);
  }
});

test('extracts meaningful terms and skips stopwords', () => {
  const terms = extractTerms(parseNotes(RICH_NOTES)).map((t) => t.term);

  assert.ok(terms.length > 0);
  for (const stop of ['the', 'and', 'is', 'by', 'to']) {
    assert.ok(!terms.includes(stop), `"${stop}" is a stopword and must not be a key term`);
  }
  assert.ok(
    terms.some((t) => ['photosynthesis', 'calvin', 'rubisco', 'light', 'water'].includes(t)),
    `expected a domain term, got ${terms.join(', ')}`,
  );
});

test('coverage detects the sections that are present', () => {
  const coverage = assessCoverage(parseNotes(RICH_NOTES));
  const covered = Object.fromEntries(coverage.map((s) => [s.key, s.covered]));

  assert.equal(covered.definition, true, 'notes define the term');
  assert.equal(covered.mechanism, true, 'numbered steps signal a mechanism');
  assert.equal(covered.examples, true, '"For instance" signals an example');
  assert.equal(covered.pitfalls, true, '"Common mistakes" signals pitfalls');
});

test('"example" does not count as covering the exam-angles section', () => {
  const coverage = assessCoverage(parseNotes('For example, a plant in bright light saturates.'));
  const byKey = Object.fromEntries(coverage.map((s) => [s.key, s.covered]));

  assert.equal(byKey.examples, true, 'it is an example');
  assert.equal(byKey.application, false, '"example" must not be read as "exam"');

  // The real signal still works.
  const real = assessCoverage(parseNotes('This comes up in the exam as a 6-mark question.'));
  assert.equal(real.find((s) => s.key === 'application').covered, true);
});

test('coverage flags what thin notes are missing', () => {
  const comparison = compareNotes(THIN_NOTES, { subject: 'Biology', topic: 'Photosynthesis' });

  assert.ok(comparison.coverageScore < 50, `expected a low score, got ${comparison.coverageScore}`);
  assert.ok(comparison.gaps.length >= 4, 'thin notes leave several slots empty');
  assert.ok(comparison.suggestions.length > 0);
  assert.ok(
    comparison.suggestions.some((s) => /example/i.test(s)),
    'missing examples are called out',
  );
});

test('comparison never invents content for missing sections', () => {
  const comparison = compareNotes(THIN_NOTES, { subject: 'Biology', topic: 'Photosynthesis' });

  for (const section of comparison.structured) {
    if (section.covered) {
      // Anything shown must be the learner's own text.
      for (const line of section.content) {
        assert.ok(THIN_NOTES.includes(line), 'covered content is quoted from the learner, not generated');
      }
    } else {
      assert.equal(section.content.length, 0, 'empty slots stay empty');
      assert.ok(section.prompt.length > 10, 'and carry a prompt instead');
    }
  }
});

test('comparison always produces both columns and a full section list', () => {
  const comparison = compareNotes(RICH_NOTES, { subject: 'Biology', topic: 'Photosynthesis' });

  assert.equal(comparison.structured.length, NOTE_SECTIONS.length);
  assert.ok(comparison.strengths.length > 0, 'strong notes get credit');
  assert.ok(comparison.coverageScore > 50);
  assert.equal(comparison.topic, 'Photosynthesis');
});

test('empty notes still produce a usable, encouraging comparison', () => {
  const comparison = compareNotes('', { topic: 'Photosynthesis' });
  assert.equal(comparison.coverageScore, 0);
  assert.equal(comparison.gaps.length, NOTE_SECTIONS.length);
  assert.doesNotThrow(() => buildLearnMode(comparison));
});

test('Learn Mode steps always end with something for the learner to do', () => {
  const comparison = compareNotes(RICH_NOTES, { subject: 'Biology', topic: 'Photosynthesis' });
  const learn = buildLearnMode(comparison);

  assert.ok(learn.steps.length >= 4);
  for (const step of learn.steps) {
    assert.ok(step.title && step.body, 'each step is substantive');
    assert.ok(step.analogy.length > 10, 'each step carries an analogy');
    assert.ok(step.check.length > 10, 'each step ends in a check for understanding');
  }
  assert.ok(learn.reflection.length >= 2);
});
