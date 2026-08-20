/** Minimal DOM helpers — no framework, no build step. */

/**
 * Create an element.
 * `props` supports `class`, `text`, `html`, `dataset`, `on*` handlers and any
 * plain attribute. Children may be nodes, strings, or nested arrays.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * Render a very small subset of markdown (`**bold**`, `*italic*`) safely by
 * escaping first and only then introducing tags.
 */
export function inlineMarkdown(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(\S[^*]*?)\*/g, '$1<em>$2</em>');
}

/** Trigger a client-side file download. */
export function download(filename, contents, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Brief inline confirmation, so actions never feel like they did nothing. */
export function flash(node, message) {
  const original = node.textContent;
  node.textContent = message;
  node.classList.add('is-flashing');
  setTimeout(() => {
    node.textContent = original;
    node.classList.remove('is-flashing');
  }, 1600);
}

/**
 * Open/closed state for disclosure panels, keyed and kept outside the DOM.
 *
 * The app re-renders wholesale on every state change, so a plain <details>
 * would snap shut the moment you ticked a task inside it — which is exactly
 * when you least want it to.
 */
const detailsState = new Map();

export function details(key, summaryText, children, defaultOpen = false) {
  if (!detailsState.has(key)) detailsState.set(key, defaultOpen);

  const node = el('details', { open: detailsState.get(key) || undefined }, [
    el('summary', { text: summaryText }),
    children,
  ]);
  node.addEventListener('toggle', () => detailsState.set(key, node.open));
  return node;
}

export function section(title, subtitle, children) {
  return el('section', { class: 'panel' }, [
    el('header', { class: 'panel-head' }, [
      el('h2', { text: title }),
      subtitle ? el('p', { class: 'muted', text: subtitle }) : null,
    ]),
    el('div', { class: 'panel-body' }, children),
  ]);
}

export function empty(message, actionLabel, onAction) {
  return el('div', { class: 'empty' }, [
    el('p', { text: message }),
    actionLabel ? el('button', { class: 'btn', onClick: onAction, text: actionLabel }) : null,
  ]);
}
