import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AP_DISCLAIMER,
  COURSES,
  GRADES,
  SUBJECTS,
  courseById,
  courseUrl,
  embedUrl,
  explainRejection,
  filterCourses,
  isValidVideoId,
  parseVideoId,
  thumbnailUrl,
  watchUrl,
} from '../src/core/khan.js';

/* ------------------------------------------------------------- catalog -- */

test('the catalog covers every grade from 6 to 12 in each subject it claims', () => {
  for (const subject of SUBJECTS) {
    const inSubject = filterCourses({ subject: subject.key });
    assert.ok(inSubject.length > 0, `${subject.label} has no courses`);
  }

  // Maths, science and social studies should reach every grade 6-12.
  for (const key of ['math', 'science', 'social']) {
    for (const grade of GRADES) {
      const matches = filterCourses({ grade, subject: key });
      assert.ok(matches.length > 0, `no ${key} course for grade ${grade}`);
    }
  }
});

test('course entries are well formed and uniquely identified', () => {
  const ids = new Set();
  for (const course of COURSES) {
    assert.ok(course.id && !ids.has(course.id), `duplicate or missing id: ${course.id}`);
    ids.add(course.id);

    assert.ok(course.name && course.name.length > 2, `bad name on ${course.id}`);
    assert.ok(SUBJECTS.some((s) => s.key === course.subject), `${course.id} has unknown subject`);
    assert.ok(Array.isArray(course.grades) && course.grades.length, `${course.id} has no grades`);

    for (const grade of course.grades) {
      assert.ok(GRADES.includes(grade), `${course.id} claims out-of-range grade ${grade}`);
    }
    // Grades must be ascending so the "Grades 9–12" label is truthful.
    const sorted = [...course.grades].sort((a, b) => a - b);
    assert.deepEqual(course.grades, sorted, `${course.id} grades are not in order`);
  }
});

test('every AP course Khan Academy publishes is present, and no invented ones', () => {
  const ap = filterCourses({ ap: true }).map((c) => c.name).sort();

  const expected = [
    'AP Art History',
    'AP Biology',
    'AP Calculus AB',
    'AP Calculus BC',
    'AP Chemistry',
    'AP Computer Science Principles',
    'AP Environmental Science',
    'AP Macroeconomics',
    'AP Microeconomics',
    'AP Physics 1',
    'AP Physics 2',
    'AP Physics C: Mechanics',
    'AP Precalculus',
    'AP Statistics',
    'AP US Government and Politics',
    'AP US History',
    'AP World History',
  ].sort();

  assert.deepEqual(ap, expected);

  // Khan Academy has no AP English courses — listing one would send a student
  // looking for something that does not exist.
  assert.ok(!ap.some((name) => /english|literature|language and composition/i.test(name)));
});

test('AP courses carry the supplemental disclaimer', () => {
  assert.match(AP_DISCLAIMER, /not reviewed or approved by the College Board/i);
  assert.match(AP_DISCLAIMER, /alongside your class/i);
});

test('filters compose', () => {
  const apMaths = filterCourses({ subject: 'math', ap: true });
  assert.ok(apMaths.length >= 4);
  assert.ok(apMaths.every((c) => c.ap && c.subject === 'math'));

  const grade6 = filterCourses({ grade: 6 });
  assert.ok(grade6.every((c) => c.grades.includes(6)));
  assert.ok(!grade6.some((c) => c.ap), 'no AP course is pitched at 6th grade');

  assert.equal(filterCourses({ grade: 6, subject: 'math', ap: true }).length, 0);
  assert.equal(courseById('ap-bio').name, 'AP Biology');
  assert.equal(courseById('nope'), null);
});

test('course links point at khanacademy.org and carry the course name', () => {
  for (const course of COURSES) {
    const url = new URL(courseUrl(course));
    assert.equal(url.hostname, 'www.khanacademy.org');
    assert.equal(url.searchParams.get('page_search_query'), course.name);
  }
});

/* -------------------------------------------------------------- videos -- */

test('video ids are accepted only in the exact YouTube shape', () => {
  assert.ok(isValidVideoId('NybHckSEQBI'));
  assert.ok(isValidVideoId('-5gBJze0-yQ'));
  assert.ok(!isValidVideoId('short'));
  assert.ok(!isValidVideoId('twelve_chars'));
  assert.ok(!isValidVideoId('has spaces!'));
  assert.ok(!isValidVideoId(''));
  assert.ok(!isValidVideoId(null));
});

test('ids are extracted from every link shape a learner might paste', () => {
  const id = 'NybHckSEQBI';
  const accepted = [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=10`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.khanacademy.org/embed_video?v=${id}`,
    `youtube.com/watch?v=${id}`,
    id,
    `  ${id}  `,
  ];
  for (const input of accepted) {
    assert.equal(parseVideoId(input), id, `failed to parse: ${input}`);
  }
});

test('anything that is not a real video id is refused rather than guessed', () => {
  const refused = [
    'https://www.khanacademy.org/math/algebra/x2f8bb/v/intro-to-slope',
    'https://www.khanacademy.org/math/algebra',
    'https://vimeo.com/123456789',
    'https://example.com/watch?v=NybHckSEQBI',
    'https://www.youtube.com/watch?v=tooshort',
    'https://www.youtube.com/',
    'not a url at all',
    '',
    null,
    undefined,
  ];
  for (const input of refused) {
    assert.equal(parseVideoId(input), null, `should not have parsed: ${input}`);
  }
});

test('a lookalike domain cannot smuggle a video through', () => {
  // The host check must be exact — "khanacademy.org.evil.com" is not Khan.
  assert.equal(parseVideoId('https://khanacademy.org.evil.com/embed_video?v=NybHckSEQBI'), null);
  assert.equal(parseVideoId('https://notyoutube.com/watch?v=NybHckSEQBI'), null);
  // But real subdomains are fine.
  assert.equal(parseVideoId('https://es.khanacademy.org/embed_video?v=NybHckSEQBI'), 'NybHckSEQBI');
});

test('embed urls are privacy-preserving and well formed', () => {
  const url = new URL(embedUrl('NybHckSEQBI'));
  assert.equal(url.hostname, 'www.youtube-nocookie.com', 'nocookie keeps YouTube from tracking a student');
  assert.equal(url.pathname, '/embed/NybHckSEQBI');
  assert.equal(url.searchParams.get('rel'), '0', 'no unrelated recommended videos after playback');

  assert.equal(new URL(embedUrl('NybHckSEQBI', { autoplay: true })).searchParams.get('autoplay'), '1');
  assert.equal(embedUrl('bad'), null, 'an invalid id must never become a src');
  assert.equal(embedUrl(''), null);
});

test('watch and thumbnail urls refuse invalid ids too', () => {
  assert.equal(watchUrl('NybHckSEQBI'), 'https://www.youtube.com/watch?v=NybHckSEQBI');
  assert.match(thumbnailUrl('NybHckSEQBI'), /^https:\/\/i\.ytimg\.com\/vi\/NybHckSEQBI\//);
  assert.equal(watchUrl('nope'), null);
  assert.equal(thumbnailUrl('nope'), null);
});

test('rejections explain what to do instead', () => {
  assert.match(explainRejection('https://www.khanacademy.org/math/algebra/v/intro-to-slope'), /Share/);
  assert.match(explainRejection('https://www.youtube.com/'), /youtube/i);
  assert.match(explainRejection('https://vimeo.com/1'), /vimeo\.com/);
  assert.match(explainRejection(''), /paste a link/i);
  assert.match(explainRejection('gibberish'), /does not look like a link|Only YouTube/i);
});
