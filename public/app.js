'use strict';

const form = document.getElementById('save-form');
const urlInput = document.getElementById('url-input');
const saveButton = document.getElementById('save-button');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('links-list');
const emptyState = document.getElementById('empty-state');
const favouriteFilter = document.getElementById('filter-favourites');

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function setStatus(message, kind = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.kind = message ? kind : '';
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (res.status === 204) {
    return null;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    // Non-JSON responses are only tolerated when the request already failed.
    if (res.ok) {
      throw new Error(`Unexpected non-JSON response (${res.status})`);
    }
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok || body.success === false) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body.data;
}

async function loadLinks() {
  const onlyFavourites = favouriteFilter.checked;
  try {
    const links = await api(`/links${onlyFavourites ? '?favourite=1' : ''}`);
    renderLinks(links);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function renderLinks(links) {
  listEl.replaceChildren(...links.map(renderLink));
  emptyState.hidden = links.length > 0;
}

function renderLink(link) {
  const item = document.createElement('li');
  item.className = 'link';

  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'link__star';
  star.setAttribute('aria-pressed', String(link.favourite));
  star.setAttribute(
    'aria-label',
    link.favourite ? 'Remove from favourites' : 'Add to favourites'
  );
  star.textContent = link.favourite ? '★' : '☆';
  star.addEventListener('click', () => toggleFavourite(link));

  const body = document.createElement('div');
  body.className = 'link__body';

  const title = document.createElement('a');
  title.className = 'link__title';
  title.href = link.url;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = link.title;

  const meta = document.createElement('div');
  meta.className = 'link__meta';
  const host = document.createElement('span');
  host.className = 'link__host';
  host.textContent = safeHost(link.url);
  const time = document.createElement('time');
  time.dateTime = link.savedAt;
  time.textContent = dateFormatter.format(new Date(link.savedAt));
  meta.append(host, document.createTextNode(' · '), time);

  body.append(title, meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link__delete';
  remove.setAttribute('aria-label', `Delete ${link.title}`);
  remove.textContent = 'Delete';
  remove.addEventListener('click', () => deleteLink(link.id));

  item.append(star, body, remove);
  return item;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function saveLink(url) {
  saveButton.disabled = true;
  setStatus('Fetching title…');
  try {
    await api('/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    form.reset();
    setStatus('Saved.', 'success');
    await loadLinks();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    saveButton.disabled = false;
  }
}

async function toggleFavourite(link) {
  try {
    await api(`/links/${link.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favourite: !link.favourite }),
    });
    await loadLinks();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function deleteLink(id) {
  try {
    await api(`/links/${id}`, { method: 'DELETE' });
    await loadLinks();
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url) {
    setStatus('Please enter a URL.', 'error');
    return;
  }
  saveLink(url);
});

favouriteFilter.addEventListener('change', loadLinks);

loadLinks();
