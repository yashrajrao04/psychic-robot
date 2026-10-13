/**
 * Learn — Khan Academy course catalog and video library.
 *
 * Courses carry no pre-loaded videos. Khan Academy's video ids are not
 * derivable from its lesson URLs, and shipping ids that had not been checked
 * against the real channel would risk embedding somebody else's re-upload under
 * a Khan Academy label. So videos are added by pasting a link, and the app
 * verifies each one against YouTube's oEmbed endpoint at the moment it is
 * added: the real title and channel come back, and anything not published by
 * Khan Academy is labelled as such rather than quietly trusted.
 */

import { el, section, empty, details } from '../dom.js';
import * as store from '../store.js';
import {
  AP_DISCLAIMER,
  GRADES,
  SUBJECTS,
  courseById,
  courseUrl,
  embedUrl,
  explainRejection,
  filterCourses,
  parseVideoId,
  thumbnailUrl,
  watchUrl,
} from '../../core/khan.js';

const ui = { open: null, feedback: {} };

/**
 * Ask YouTube what a video actually is.
 *
 * oEmbed is public and needs no key. If it is unreachable — offline, blocked,
 * or CORS-refused — the video is still saved, just without a confirmed title.
 * Verification is a bonus, never a gate.
 */
async function resolveVideo(videoId) {
  const endpoint =
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  try {
    const response = await fetch(endpoint, { mode: 'cors' });
    if (!response.ok) return null;
    const data = await response.json();
    return { title: data.title || '', author: data.author_name || '' };
  } catch {
    return null;
  }
}

function isKhanChannel(author) {
  return /khan\s*academy/i.test(String(author || ''));
}

function videoCard(course, video) {
  const src = embedUrl(video.videoId);
  const verified = video.author ? isKhanChannel(video.author) : null;

  return el('article', { class: 'video-card' }, [
    el('div', { class: 'video-frame' }, [
      el('iframe', {
        src,
        title: video.title || `Video ${video.videoId}`,
        loading: 'lazy',
        allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        referrerpolicy: 'strict-origin-when-cross-origin',
        allowfullscreen: true,
      }),
    ]),
    el('div', { class: 'video-meta' }, [
      el('p', { class: 'video-title', text: video.title || video.videoId }),
      el('p', { class: 'video-sub' }, [
        verified === true
          ? el('span', { class: 'badge verified', title: `Published by ${video.author}`, text: '✓ Khan Academy' })
          : verified === false
            ? el('span', { class: 'badge unverified', title: `Published by ${video.author}`, text: `⚠ ${video.author}` })
            : el('span', { class: 'badge unknown', title: 'Could not reach YouTube to confirm the channel', text: 'channel unconfirmed' }),
        el('a', { class: 'link small', href: watchUrl(video.videoId), target: '_blank', rel: 'noopener', text: 'open on YouTube ↗' }),
      ]),
      el('button', {
        class: 'icon-btn danger',
        type: 'button',
        title: 'Remove this video',
        text: '×',
        onClick: () => store.removeVideo(course.id, video.videoId),
      }),
    ]),
  ]);
}

function addVideoForm(course) {
  const input = el('input', {
    type: 'url',
    class: 'input',
    placeholder: 'Paste a YouTube video URL',
    'aria-label': `Add a video to ${course.name}`,
  });
  // Kept in module state for the same reason as Study Buddy's notice: adding a
  // video writes to the store, which re-renders and would discard a message
  // held only in the DOM.
  const saved = ui.feedback[course.id];
  const feedback = el('p', { class: saved ? saved.className : 'muted small', text: saved ? saved.text : '' });
  const say = (className, text) => {
    ui.feedback[course.id] = { className, text };
    feedback.className = className;
    feedback.textContent = text;
  };

  const submit = async () => {
    const raw = input.value;
    const videoId = parseVideoId(raw);

    if (!videoId) {
      say('notice error small', explainRejection(raw));
      return;
    }

    say('muted small', 'Checking the video with YouTube…');

    store.addVideo(course.id, { videoId, title: '', author: '' });
    input.value = '';

    const resolved = await resolveVideo(videoId);
    if (resolved) {
      const khan = isKhanChannel(resolved.author);
      say(
        khan ? 'notice ok small' : 'notice small',
        khan
          ? `Added "${resolved.title}" — confirmed Khan Academy.`
          : `Added, but this was published by ${resolved.author}, not Khan Academy.`,
      );
      store.updateVideo(course.id, videoId, resolved);
    } else {
      say('muted small', 'Added. YouTube could not be reached, so the channel is unconfirmed.');
    }
  };

  return el('div', { class: 'add-video' }, [
    el('form', { class: 'inline-form', onSubmit: (e) => { e.preventDefault(); submit(); } }, [
      input,
      el('button', { class: 'btn', type: 'submit', text: 'Add video' }),
    ]),
    feedback,
  ]);
}

function courseCard(course) {
  const videos = store.videosFor(course.id);
  const isOpen = ui.open === course.id;
  const linkedTopics = store.topicsWithSubject().filter((t) => t.courseId === course.id);

  return el('article', { class: `course-card${course.ap ? ' is-ap' : ''}` }, [
    el('header', { class: 'course-head' }, [
      el('div', { class: 'course-title' }, [
        el('h3', { text: course.name }),
        el('p', { class: 'muted small', text: `Grades ${course.grades[0]}–${course.grades[course.grades.length - 1]}` }),
      ]),
      course.ap ? el('span', { class: 'pill pill-hard', text: 'AP' }) : null,
      videos.length ? el('span', { class: 'pill', text: `${videos.length} video${videos.length === 1 ? '' : 's'}` }) : null,
    ]),

    course.note ? el('p', { class: 'muted small', text: course.note }) : null,

    el('div', { class: 'button-row' }, [
      el('a', {
        class: 'btn',
        href: courseUrl(course),
        target: '_blank',
        rel: 'noopener',
        text: 'Open on Khan Academy ↗',
      }),
      el('button', {
        class: 'btn',
        type: 'button',
        text: isOpen ? 'Hide videos' : videos.length ? `Videos (${videos.length})` : 'Add videos',
        onClick: () => {
          ui.open = isOpen ? null : course.id;
          store.refresh();
        },
      }),
      linkedTopics.length
        ? el('span', { class: 'muted small', text: `On your plan as "${linkedTopics[0].topic}"` })
        : el('button', {
            class: 'btn primary',
            type: 'button',
            title: 'Create a study topic for this course and schedule it on the ladder',
            text: 'Add to my plan',
            onClick: () => {
              const subject = store.ensureSubject(SUBJECTS.find((s) => s.key === course.subject)?.label || 'Khan Academy');
              store.addTopic(subject.id, course.name, course.ap ? 'hard' : 'medium', undefined, course.id);
            },
          }),
    ]),

    isOpen
      ? el('div', { class: 'course-videos' }, [
          addVideoForm(course),
          videos.length
            ? el('div', { class: 'video-grid' }, videos.map((v) => videoCard(course, v)))
            : el('p', {
                class: 'muted small',
                text:
                  'No videos saved yet. Open the course on Khan Academy, pick a video, use Share to copy its ' +
                  'YouTube link, and paste it above — it will play right here and show up on this topic’s study days.',
              }),
        ])
      : null,
  ]);
}

export function renderLearn(plan, { goToTab } = {}) {
  const { library } = store.getState();
  const courses = filterCourses({
    grade: library.grade,
    subject: library.subject,
    ap: library.apOnly ? true : null,
  });

  const gradePicker = el('div', { class: 'field' }, [
    el('span', { text: 'Grade' }),
    el('div', { class: 'topic-picker' }, [
      el('button', {
        type: 'button',
        class: `chip${library.grade === null ? ' is-active' : ''}`,
        text: 'All',
        onClick: () => store.setLibraryFilter({ grade: null }),
      }),
      ...GRADES.map((g) =>
        el('button', {
          type: 'button',
          class: `chip${library.grade === g ? ' is-active' : ''}`,
          text: String(g),
          onClick: () => store.setLibraryFilter({ grade: g }),
        }),
      ),
    ]),
  ]);

  const subjectPicker = el('div', { class: 'field' }, [
    el('span', { text: 'Subject' }),
    el(
      'div',
      { class: 'topic-picker' },
      SUBJECTS.map((s) =>
        el('button', {
          type: 'button',
          class: `chip${library.subject === s.key ? ' is-active' : ''}`,
          text: s.label,
          onClick: () => store.setLibraryFilter({ subject: s.key }),
        }),
      ),
    ),
  ]);

  const apToggle = el('label', { class: 'check-item' }, [
    el('input', {
      type: 'checkbox',
      id: 'ap-only',
      checked: library.apOnly,
      onChange: (e) => store.setLibraryFilter({ apOnly: e.target.checked }),
    }),
    el('label', { for: 'ap-only' }, [el('span', { text: 'AP courses only' })]),
  ]);

  const savedCount = Object.values(library.videos).reduce((n, list) => n + list.length, 0);

  return el('div', { class: 'view' }, [
    section(
      'Learn',
      'Khan Academy courses for grades 6–12, plus every AP course they offer. Save videos against a course and ' +
        'they play here and on that topic’s study days.',
      [
        gradePicker,
        subjectPicker,
        apToggle,
        library.apOnly || courses.some((c) => c.ap)
          ? el('p', { class: 'notice small', text: AP_DISCLAIMER })
          : null,
        el('p', {
          class: 'muted small',
          text: `${courses.length} course${courses.length === 1 ? '' : 's'} shown · ${savedCount} video${savedCount === 1 ? '' : 's'} saved overall`,
        }),
      ],
    ),

    courses.length
      ? el('div', { class: 'course-grid' }, courses.map(courseCard))
      : section('Nothing here', null, [
          empty('No courses match that filter. Khan Academy’s English coverage in particular thins out above 9th grade.'),
        ]),
  ]);
}

/** Videos saved for whichever course a topic is linked to. */
export function videosForTopic(topic) {
  return topic?.courseId ? store.videosFor(topic.courseId) : [];
}

/** A compact player list, used on session cards so videos meet you on the day. */
export function topicVideoList(topic) {
  const videos = videosForTopic(topic);
  if (!videos.length) return null;
  const course = courseById(topic.courseId);

  return details(
    `vids:${topic.id}`,
    `${videos.length} Khan Academy video${videos.length === 1 ? '' : 's'}`,
    el('div', { class: 'video-strip' }, videos.map((v) =>
      el('a', {
        class: 'video-chip',
        href: watchUrl(v.videoId),
        target: '_blank',
        rel: 'noopener',
        title: course ? `${course.name} — ${v.title || v.videoId}` : v.title || v.videoId,
      }, [
        el('img', { src: thumbnailUrl(v.videoId), alt: '', loading: 'lazy' }),
        el('span', { class: 'video-chip-title', text: v.title || v.videoId }),
      ]),
    )),
  );
}
