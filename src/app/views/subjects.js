/** Subjects & Topics: the input side of the planner. */

import { el, section, empty } from '../dom.js';
import * as store from '../store.js';
import { DIFFICULTY_PROFILES } from '../../core/scheduler.js';
import { WEEKDAY_NAMES } from '../../core/dates.js';

const DIFFICULTIES = Object.values(DIFFICULTY_PROFILES);

function difficultyPicker(topic) {
  return el(
    'div',
    { class: 'difficulty-picker', role: 'group', 'aria-label': `Difficulty for ${topic.topic}` },
    DIFFICULTIES.map((profile) =>
      el('button', {
        class: `chip chip-${profile.key}${topic.difficulty === profile.key ? ' is-active' : ''}`,
        type: 'button',
        title: `${profile.label}: ${profile.offsets.length} passes, days ${profile.offsets.map((o) => o + 1).join(' / ')}`,
        text: profile.label,
        onClick: () => store.setTopicDifficulty(topic.id, profile.key),
      }),
    ),
  );
}

function topicRow(topic, index, total) {
  return el('li', { class: 'topic-row' }, [
    el('span', { class: 'topic-name' }, [
      el('span', { class: `dot dot-${topic.difficulty}` }),
      el('span', { text: topic.topic }),
    ]),
    difficultyPicker(topic),
    el('div', { class: 'row-actions' }, [
      el('button', {
        class: 'icon-btn',
        type: 'button',
        title: 'Move earlier',
        text: '↑',
        disabled: index === 0,
        onClick: () => store.moveTopic(topic.id, -1),
      }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        title: 'Move later',
        text: '↓',
        disabled: index === total - 1,
        onClick: () => store.moveTopic(topic.id, 1),
      }),
      el('button', {
        class: 'icon-btn danger',
        type: 'button',
        title: 'Remove topic',
        text: '×',
        onClick: () => store.removeTopic(topic.id),
      }),
    ]),
  ]);
}

function subjectCard(subject) {
  const topics = store.topicsForSubject(subject.id);
  const all = store.getState().topics;

  const input = el('input', {
    type: 'text',
    class: 'input',
    placeholder: 'Add topics — comma or line separated',
    'aria-label': `Add topics to ${subject.name}`,
  });
  const difficultySelect = el(
    'select',
    { class: 'input select', 'aria-label': 'Difficulty for new topics' },
    DIFFICULTIES.map((d) => el('option', { value: d.key, text: d.label, selected: d.key === 'medium' })),
  );

  const submit = () => {
    store.addTopicsBulk(subject.id, input.value, difficultySelect.value);
    input.value = '';
  };

  return el('article', { class: 'subject-card', style: { '--subject-color': subject.color } }, [
    el('header', { class: 'subject-head' }, [
      el('input', {
        class: 'subject-title',
        value: subject.name,
        'aria-label': 'Subject name',
        onChange: (e) => store.renameSubject(subject.id, e.target.value),
      }),
      el('span', { class: 'muted small', text: `${topics.length} topic${topics.length === 1 ? '' : 's'}` }),
      el('button', {
        class: 'icon-btn danger',
        type: 'button',
        title: 'Delete subject and its topics',
        text: '×',
        onClick: () => {
          if (confirm(`Delete "${subject.name}" and its ${topics.length} topic(s)?`)) store.removeSubject(subject.id);
        },
      }),
    ]),

    topics.length
      ? el(
          'ul',
          { class: 'topic-list' },
          topics.map((t) => topicRow(t, all.indexOf(t), all.length)),
        )
      : el('p', { class: 'muted small', text: 'No topics yet — add the specific things you need to revise, not just the chapter name.' }),

    el('form', { class: 'inline-form', onSubmit: (e) => { e.preventDefault(); submit(); } }, [
      input,
      difficultySelect,
      el('button', { class: 'btn', type: 'submit', text: 'Add' }),
    ]),
  ]);
}

function settingsPanel() {
  const { settings } = store.getState();

  return section('Plan settings', 'These shape the calendar the scheduler builds.', [
    el('div', { class: 'settings-grid' }, [
      el('label', { class: 'field' }, [
        el('span', { text: 'Start date' }),
        el('input', {
          type: 'date',
          class: 'input',
          value: settings.startDate,
          onChange: (e) => store.updateSettings({ startDate: e.target.value }),
        }),
      ]),
      el('label', { class: 'field' }, [
        el('span', { text: 'Plan length' }),
        el(
          'select',
          {
            class: 'input select',
            onChange: (e) => store.updateSettings({ horizonDays: Number(e.target.value) }),
          },
          [14, 21, 28, 42, 56].map((days) =>
            el('option', { value: days, text: `${days / 7} weeks`, selected: settings.horizonDays === days }),
          ),
        ),
      ]),
      el('label', { class: 'field' }, [
        el('span', { text: 'Session start time' }),
        el('input', {
          type: 'time',
          class: 'input',
          value: settings.startTime,
          onChange: (e) => store.updateSettings({ startTime: e.target.value }),
        }),
      ]),
    ]),

    el('div', { class: 'field' }, [
      el('span', { text: 'Study days' }),
      el(
        'div',
        { class: 'weekday-picker' },
        WEEKDAY_NAMES.map((name, index) =>
          el('button', {
            type: 'button',
            class: `chip${settings.availableWeekdays.includes(index) ? ' is-active' : ''}`,
            text: name,
            onClick: () => {
              const next = settings.availableWeekdays.includes(index)
                ? settings.availableWeekdays.filter((d) => d !== index)
                : [...settings.availableWeekdays, index].sort();
              // Never leave zero study days — the scheduler would have nowhere to place work.
              if (next.length) store.updateSettings({ availableWeekdays: next });
            },
          }),
        ),
      ),
      el('p', { class: 'muted small', text: 'Days you switch off stay empty. The plan simply grows longer to fit.' }),
    ]),
  ]);
}

export function renderSubjects() {
  const state = store.getState();

  const newSubject = el('input', { type: 'text', class: 'input', placeholder: 'e.g. Biology, Interview Prep' });

  const addForm = el(
    'form',
    {
      class: 'inline-form',
      onSubmit: (e) => {
        e.preventDefault();
        store.addSubject(newSubject.value);
        newSubject.value = '';
      },
    },
    [newSubject, el('button', { class: 'btn primary', type: 'submit', text: 'Add subject' })],
  );

  return el('div', { class: 'view' }, [
    section(
      'Subjects & topics',
      'One row per subject. Mark each topic hard, medium or easy — that is what decides how often it comes back.',
      [
        addForm,
        state.subjects.length
          ? el('div', { class: 'subject-grid' }, state.subjects.map(subjectCard))
          : empty('No subjects yet. Add one above, or load a worked example to see how a plan looks.', 'Load example plan', () =>
              store.loadSample(),
            ),
      ],
    ),
    settingsPanel(),
  ]);
}
