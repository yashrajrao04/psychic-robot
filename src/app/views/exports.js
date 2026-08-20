/** Sync & export: Google Calendar, Notion, Excel/CSV. */

import { el, section, empty, download, copyText, flash } from '../dom.js';
import * as store from '../store.js';
import {
  toCSV,
  toICS,
  toNotionCSV,
  toNotionMarkdown,
  toTaskCSV,
  eventTitle,
  eventDescription,
} from '../../core/exporters.js';

function card(title, description, steps, actions) {
  return el('article', { class: 'export-card' }, [
    el('h3', { text: title }),
    el('p', { class: 'muted', text: description }),
    el('ol', { class: 'steps' }, steps.map((s) => el('li', { text: s }))),
    el('div', { class: 'button-row' }, actions),
  ]);
}

export function renderExports(plan) {
  const { settings } = store.getState();

  if (!plan.sessions.length) {
    return el('div', { class: 'view' }, [
      section('Sync & export', null, [empty('Build a plan first, then export it anywhere.')]),
    ]);
  }

  const sessions = plan.sessions;
  const startTime = settings.startTime;

  const preview = sessions[0];

  return el('div', { class: 'view' }, [
    section(
      'Sync & export',
      `${sessions.length} sessions ready. Every export keeps the same shape: one topic per event per day, ` +
        'titled "[Subject] – [Topic]", with the day\'s checklist as the description.',
      [
        el('div', { class: 'preview' }, [
          el('h4', { text: 'Event preview' }),
          el('p', {}, [el('strong', { text: 'Title: ' }), eventTitle(preview)]),
          el('p', {}, [el('strong', { text: 'When: ' }), `${preview.iso} at ${startTime}`]),
          el('pre', { class: 'preview-body', text: eventDescription(preview) }),
          el('p', { class: 'muted small', text: 'Change the session time under Subjects & topics → Plan settings.' }),
        ]),

        el('div', { class: 'export-grid' }, [
          card(
            'Google Calendar',
            'Import the whole plan as timed events with a 30-minute reminder each.',
            [
              'Download the .ics file below.',
              'In Google Calendar, open Settings → Import & export.',
              'Choose the file, pick the destination calendar, and import.',
            ],
            [
              el('button', {
                class: 'btn primary',
                text: 'Download .ics',
                onClick: (e) => {
                  download('study-plan.ics', toICS(sessions, { startTime }), 'text/calendar;charset=utf-8');
                  flash(e.target, 'Downloaded');
                },
              }),
              el('button', {
                class: 'btn',
                text: 'Download Google CSV',
                onClick: (e) => {
                  download('study-plan-google.csv', toCSV(sessions, { startTime }), 'text/csv;charset=utf-8');
                  flash(e.target, 'Downloaded');
                },
              }),
            ],
          ),

          card(
            'Notion',
            'Paste as a page, or import as a database with one row per session.',
            [
              'Copy the markdown and paste it into a Notion page — headings and checkboxes come through.',
              'Or download the database CSV and use Notion\'s Import → CSV.',
              'Tasks arrive as real checkboxes you can tick off in Notion.',
            ],
            [
              el('button', {
                class: 'btn primary',
                text: 'Copy Notion markdown',
                onClick: async (e) => {
                  const ok = await copyText(toNotionMarkdown(sessions, { title: 'Revision Plan' }));
                  flash(e.target, ok ? 'Copied to clipboard' : 'Copy blocked — use download');
                },
              }),
              el('button', {
                class: 'btn',
                text: 'Download .md',
                onClick: (e) => {
                  download('study-plan.md', toNotionMarkdown(sessions, { title: 'Revision Plan' }), 'text/markdown');
                  flash(e.target, 'Downloaded');
                },
              }),
              el('button', {
                class: 'btn',
                text: 'Download database CSV',
                onClick: (e) => {
                  download('study-plan-notion.csv', toNotionCSV(sessions), 'text/csv;charset=utf-8');
                  flash(e.target, 'Downloaded');
                },
              }),
            ],
          ),

          card(
            'Excel / Sheets',
            'A flat table, one row per task — easy to filter, sort and pivot.',
            [
              'Download the task CSV.',
              'Open it in Excel, Numbers or Google Sheets.',
              'Filter by subject or week to build your own tracker.',
            ],
            [
              el('button', {
                class: 'btn primary',
                text: 'Download task CSV',
                onClick: (e) => {
                  download('study-plan-tasks.csv', toTaskCSV(sessions), 'text/csv;charset=utf-8');
                  flash(e.target, 'Downloaded');
                },
              }),
            ],
          ),
        ]),
      ],
    ),

    section('Your data', 'Everything lives in this browser — nothing is uploaded anywhere.', [
      el('div', { class: 'button-row' }, [
        el('button', {
          class: 'btn',
          text: 'Export all data (JSON)',
          onClick: (e) => {
            download('study-buddy-data.json', JSON.stringify(store.getState(), null, 2), 'application/json');
            flash(e.target, 'Downloaded');
          },
        }),
        el('button', {
          class: 'btn danger',
          text: 'Reset everything',
          onClick: () => {
            if (confirm('Delete all subjects, topics, notes and progress? This cannot be undone.')) store.resetAll();
          },
        }),
      ]),
    ]),
  ]);
}
