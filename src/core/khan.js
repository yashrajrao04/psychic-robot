/**
 * Khan Academy learning content.
 *
 * Two separate things live here:
 *
 *  1. A curriculum catalog — grades 6–12 across maths, English, social studies
 *     and science, plus Khan Academy's AP courses. Course *names* are taken
 *     from Khan Academy's own published course lists.
 *
 *  2. Video embedding. Khan Academy hosts its videos on YouTube, so a video is
 *     stored as a YouTube id and played through youtube-nocookie.com.
 *
 * On links: Khan Academy reorganises its URL slugs regularly — a deep path that
 * works today is a 404 next term. Course entries therefore resolve through
 * Khan Academy's own search rather than hard-coded unit paths, which survives
 * reorganisation and never sends a learner to a dead page.
 */

export const SUBJECTS = [
  { key: 'math', label: 'Maths' },
  { key: 'english', label: 'English' },
  { key: 'social', label: 'Social studies' },
  { key: 'science', label: 'Science' },
];

export const GRADES = [6, 7, 8, 9, 10, 11, 12];

/** Single place the Khan Academy URL shape is defined. */
const KHAN_ORIGIN = 'https://www.khanacademy.org';

/** A Khan Academy search link for a course name. */
export function khanSearchUrl(query) {
  return `${KHAN_ORIGIN}/search?page_search_query=${encodeURIComponent(query)}`;
}

/**
 * The catalog.
 *
 * `grades` is the band a course is normally taught in, used to filter the view;
 * it is guidance, not a gate — a 9th grader revising 7th grade ratios is doing
 * exactly the right thing.
 */
export const COURSES = [
  // ---------------------------------------------------------------- maths --
  { id: 'math-6', name: '6th grade math', subject: 'math', grades: [6] },
  { id: 'math-7', name: '7th grade math', subject: 'math', grades: [7] },
  { id: 'math-8', name: '8th grade math', subject: 'math', grades: [8] },
  { id: 'math-prealgebra', name: 'Pre-algebra', subject: 'math', grades: [6, 7, 8] },
  { id: 'math-algebra1', name: 'Algebra 1', subject: 'math', grades: [8, 9] },
  { id: 'math-geometry', name: 'Geometry', subject: 'math', grades: [9, 10] },
  { id: 'math-algebra2', name: 'Algebra 2', subject: 'math', grades: [10, 11] },
  { id: 'math-trig', name: 'Trigonometry', subject: 'math', grades: [10, 11, 12] },
  { id: 'math-precalc', name: 'Precalculus', subject: 'math', grades: [11, 12] },
  { id: 'math-stats', name: 'Statistics and probability', subject: 'math', grades: [9, 10, 11, 12] },

  // -------------------------------------------------------------- english --
  { id: 'eng-grammar', name: 'Grammar', subject: 'english', grades: [6, 7, 8, 9, 10, 11, 12] },
  {
    id: 'eng-reading',
    name: 'Reading & vocabulary',
    subject: 'english',
    grades: [6, 7, 8, 9],
    note: 'Khan Academy’s reading courses run to 9th grade; above that its English coverage is thinner than its maths and science.',
  },

  // ------------------------------------------------------- social studies --
  // Both are survey courses taught from middle school upwards — Khan Academy's
  // world history starts at the earliest human societies, which is squarely
  // 6th-grade material in most curricula.
  { id: 'soc-us-history', name: 'US history', subject: 'social', grades: [7, 8, 9, 10, 11, 12] },
  { id: 'soc-world-history', name: 'World history', subject: 'social', grades: [6, 7, 8, 9, 10, 11, 12] },
  { id: 'soc-civics', name: 'US government and civics', subject: 'social', grades: [9, 10, 11, 12] },
  { id: 'soc-macro', name: 'Macroeconomics', subject: 'social', grades: [11, 12] },
  { id: 'soc-micro', name: 'Microeconomics', subject: 'social', grades: [11, 12] },
  { id: 'soc-art-history', name: 'Art history', subject: 'social', grades: [9, 10, 11, 12] },

  // -------------------------------------------------------------- science --
  { id: 'sci-ms-bio', name: 'Middle school biology', subject: 'science', grades: [6, 7, 8] },
  { id: 'sci-ms-chem', name: 'Middle school chemistry', subject: 'science', grades: [6, 7, 8] },
  { id: 'sci-ms-physics', name: 'Middle school physics', subject: 'science', grades: [6, 7, 8] },
  { id: 'sci-ms-earth', name: 'Middle school Earth and space science', subject: 'science', grades: [6, 7, 8] },
  { id: 'sci-hs-bio', name: 'High school biology', subject: 'science', grades: [9, 10] },
  { id: 'sci-hs-chem', name: 'High school chemistry', subject: 'science', grades: [10, 11] },
  { id: 'sci-hs-physics', name: 'High school physics', subject: 'science', grades: [11, 12] },
  { id: 'sci-cosmology', name: 'Cosmology and astronomy', subject: 'science', grades: [9, 10, 11, 12] },

  // ------------------------------------------------------------------ AP --
  { id: 'ap-precalc', name: 'AP Precalculus', subject: 'math', grades: [10, 11], ap: true },
  { id: 'ap-calc-ab', name: 'AP Calculus AB', subject: 'math', grades: [11, 12], ap: true },
  { id: 'ap-calc-bc', name: 'AP Calculus BC', subject: 'math', grades: [11, 12], ap: true },
  { id: 'ap-stats', name: 'AP Statistics', subject: 'math', grades: [11, 12], ap: true },
  { id: 'ap-csp', name: 'AP Computer Science Principles', subject: 'math', grades: [10, 11, 12], ap: true },

  { id: 'ap-bio', name: 'AP Biology', subject: 'science', grades: [11, 12], ap: true },
  { id: 'ap-chem', name: 'AP Chemistry', subject: 'science', grades: [11, 12], ap: true },
  { id: 'ap-env', name: 'AP Environmental Science', subject: 'science', grades: [10, 11, 12], ap: true },
  { id: 'ap-phys-1', name: 'AP Physics 1', subject: 'science', grades: [10, 11, 12], ap: true },
  { id: 'ap-phys-2', name: 'AP Physics 2', subject: 'science', grades: [11, 12], ap: true },
  { id: 'ap-phys-c-mech', name: 'AP Physics C: Mechanics', subject: 'science', grades: [11, 12], ap: true },

  { id: 'ap-us-history', name: 'AP US History', subject: 'social', grades: [10, 11, 12], ap: true },
  { id: 'ap-world-history', name: 'AP World History', subject: 'social', grades: [9, 10, 11, 12], ap: true },
  { id: 'ap-gov', name: 'AP US Government and Politics', subject: 'social', grades: [11, 12], ap: true },
  { id: 'ap-macro', name: 'AP Macroeconomics', subject: 'social', grades: [11, 12], ap: true },
  { id: 'ap-micro', name: 'AP Microeconomics', subject: 'social', grades: [11, 12], ap: true },
  { id: 'ap-art-history', name: 'AP Art History', subject: 'social', grades: [10, 11, 12], ap: true },
];

/**
 * Khan Academy states its AP courses are not reviewed or approved by the
 * College Board and are a supplement, not a replacement for the class. Worth
 * saying out loud in a tool a student might otherwise lean on entirely.
 */
export const AP_DISCLAIMER =
  'Khan Academy’s AP courses are supplementary practice — they are not reviewed or approved by the College Board, ' +
  'and they do not cover lab work. Use them alongside your class, not instead of it.';

export function courseById(id) {
  return COURSES.find((c) => c.id === id) || null;
}

/** Filter the catalog. `grade` of null means every grade. */
export function filterCourses({ grade = null, subject = null, ap = null } = {}) {
  return COURSES.filter((course) => {
    if (subject && course.subject !== subject) return false;
    if (ap !== null && Boolean(course.ap) !== ap) return false;
    if (grade !== null && !course.grades.includes(Number(grade))) return false;
    return true;
  });
}

export function courseUrl(course) {
  return khanSearchUrl(course.name);
}

/* ------------------------------------------------------------- video ids -- */

/** YouTube ids are exactly 11 characters of url-safe base64. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isValidVideoId(id) {
  return VIDEO_ID.test(String(id || ''));
}

/**
 * Pull a YouTube video id out of a pasted YouTube URL.
 *
 * YouTube URLs only, by design. Khan Academy's lesson pages carry a slug and
 * not a video id, so there is nothing in them to extract; accepting other
 * sources would mean embedding video nobody had checked. Every YouTube link
 * shape is handled: watch, youtu.be, shorts, embed, live and /v/.
 *
 * Returns `null` rather than guessing. A wrong id does not fail loudly — it
 * silently plays something else, the worst outcome for a study tool.
 */
export function parseVideoId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const path = url.pathname.replace(/\/+$/, '');

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = path.slice(1).split('/')[0];
    return VIDEO_ID.test(id) ? id : null;
  }

  const isYouTube = host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com';
  if (!isYouTube) return null;

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;

  const match = path.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** Privacy-preserving embed URL. */
export function embedUrl(videoId, { autoplay = false } = {}) {
  if (!isValidVideoId(videoId)) return null;
  const params = new URLSearchParams({ rel: '0', modestbranding: '1' });
  if (autoplay) params.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export function watchUrl(videoId) {
  return isValidVideoId(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

export function thumbnailUrl(videoId) {
  return isValidVideoId(videoId) ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
}

/** Why a pasted link was rejected, phrased so the learner can fix it. */
export function explainRejection(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'Paste a link first.';

  let host = '';
  try {
    host = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return 'That does not look like a link. Paste the full URL from the address bar.';
  }
  // `new URL` happily accepts a bare word as a hostname, so a dotless host is
  // really just text, not a link anyone pasted from a browser.
  if (!host.includes('.')) {
    return 'That does not look like a link. Paste the full URL from the address bar.';
  }

  if (host.endsWith('khanacademy.org')) {
    return (
      'Khan Academy lesson pages do not carry the video id in their URL. On the video, use Share and copy the ' +
      'YouTube link, or open it on YouTube and copy the address bar.'
    );
  }
  if (host.includes('youtube') || host === 'youtu.be') {
    return 'That looks like a YouTube link, but no 11-character video id could be found in it.';
  }
  return `YouTube links only — that one points at ${host}.`;
}
