(async function () {
  'use strict';

  // ============================================================
  // CONFIGURATION
  // ============================================================

  const GITHUB_TOKEN = '';

  const RESERVED_PATHS = new Set([
    'orgs', 'settings', 'explore', 'features', 'topics', 'marketplace',
    'login', 'join', 'about', 'pricing', 'sponsors', 'trending',
    'collections', 'events', 'notifications', 'pulls', 'issues',
    'search', 'new', 'organizations', 'users', 'apps', 'codespaces',
  ]);

  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 200;
  const TAB_DELAY_MS = 180;
  const UNFOLLOW_DELAY_MS = 300;

  // ============================================================
  // NETWORK HELPERS
  // ============================================================

  function buildHeaders() {
    const headers = { Accept: 'application/vnd.github+json' };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    return headers;
  }

  async function assertNotRateLimited(response) {
    if (response.status !== 403 && response.status !== 429) return;
    if (response.headers.get('X-RateLimit-Remaining') !== '0') return;
    const resetHeader = response.headers.get('X-RateLimit-Reset');
    const resetTime = resetHeader
      ? new Date(Number(resetHeader) * 1000).toLocaleTimeString('en-US')
      : 'unknown';
    throw new Error(
      `GitHub API rate limit exceeded. Reset at ${resetTime}. ` +
      `Provide a Personal Access Token in GITHUB_TOKEN to increase the limit.`
    );
  }

  async function getAllPages(username, endpoint) {
    const results = [];
    let page = 1;
    while (true) {
      const url =
        `https://api.github.com/users/${encodeURIComponent(username)}/${endpoint}` +
        `?page=${page}&per_page=100`;
      const response = await fetch(url, { headers: buildHeaders() });
      if (!response.ok) {
        await assertNotRateLimited(response);
        throw new Error(`Failed to fetch ${endpoint} (page ${page}): HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) break;
      for (const user of data) results.push(user.login);
      console.log(`Fetched ${endpoint} page ${page} (${results.length} total)`);
      const linkHeader = response.headers.get('Link');
      if (!linkHeader || !/rel="next"/.test(linkHeader)) break;
      page++;
    }
    return results;
  }

  async function fetchProfile(username) {
    const url = `https://api.github.com/users/${encodeURIComponent(username)}`;
    const response = await fetch(url, { headers: buildHeaders() });
    if (!response.ok) {
      if (response.status === 404) return { login: username, error: 'Profile not found' };
      await assertNotRateLimited(response);
      return { login: username, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return {
      login: data.login,
      name: data.name || '',
      avatar: data.avatar_url || '',
      bio: data.bio || '',
      company: data.company || '',
      location: data.location || '',
      publicRepos: data.public_repos ?? 0,
      followers: data.followers ?? 0,
      following: data.following ?? 0,
      htmlUrl: data.html_url || `https://github.com/${username}`,
    };
  }

  async function unfollowUser(username) {
    if (!GITHUB_TOKEN) {
      throw new Error('A Personal Access Token with the user:follow scope is required.');
    }
    const url = `https://api.github.com/user/following/${encodeURIComponent(username)}`;
    const response = await fetch(url, { method: 'DELETE', headers: buildHeaders() });
    if (response.status === 204) {
      console.log(`Unfollowed: ${username}`);
      return true;
    }
    if (response.status === 404) {
      throw new Error('Not currently followed, or the token lacks the required scope.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication failed. The token is invalid or missing user:follow.');
    }
    await assertNotRateLimited(response);
    throw new Error(`Unfollow request failed: HTTP ${response.status}`);
  }

  async function followUser(username) {
    if (!GITHUB_TOKEN) {
      throw new Error('A Personal Access Token with the user:follow scope is required.');
    }
    const url = `https://api.github.com/user/following/${encodeURIComponent(username)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { ...buildHeaders(), 'Content-Length': '0' },
    });
    if (response.status === 204) {
      console.log(`Followed: ${username}`);
      return true;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication failed. The token is invalid or missing user:follow.');
    }
    await assertNotRateLimited(response);
    throw new Error(`Follow request failed: HTTP ${response.status}`);
  }

  function extractUsername() {
    const match = window.location.href.match(/^https?:\/\/github\.com\/([^/?#]+)/i);
    if (!match || !match[1]) return null;
    const candidate = decodeURIComponent(match[1]);
    if (RESERVED_PATHS.has(candidate.toLowerCase())) return null;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(candidate)) return null;
    return candidate;
  }

  // ============================================================
  // UI: STYLES
  // ============================================================

  function injectStyles() {
    if (document.getElementById('owf-styles')) return;
    const style = document.createElement('style');
    style.id = 'owf-styles';
    style.textContent = `
      #owf-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(1, 4, 9, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #owf-modal {
        background: #0d1117;
        color: #c9d1d9;
        border: 1px solid #30363d;
        border-radius: 12px;
        width: 760px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 48px);
        display: flex;
        flex-direction: column;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
        overflow: hidden;
      }
      #owf-header {
        padding: 16px 20px;
        border-bottom: 1px solid #21262d;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #161b22;
        flex-shrink: 0;
      }
      #owf-header h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: #f0f6fc;
      }
      #owf-close {
        background: transparent;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 4px 10px;
        border-radius: 6px;
      }
      #owf-close:hover {
        background: #30363d;
        color: #f0f6fc;
      }
      #owf-tabs {
        display: flex;
        border-bottom: 1px solid #21262d;
        background: #0d1117;
        flex-shrink: 0;
        padding: 0 20px;
        gap: 4px;
      }
      .owf-tab {
        background: transparent;
        border: none;
        color: #8b949e;
        padding: 12px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        transition: color 0.15s, border-color 0.15s;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .owf-tab:hover {
        color: #c9d1d9;
      }
      .owf-tab.active {
        color: #f0f6fc;
        border-bottom-color: #f78166;
      }
      .owf-tab-count {
        background: #21262d;
        color: #8b949e;
        font-size: 11px;
        font-weight: 600;
        padding: 1px 7px;
        border-radius: 10px;
        min-width: 18px;
        text-align: center;
      }
      .owf-tab.active .owf-tab-count {
        background: #30363d;
        color: #f0f6fc;
      }
      .owf-panel {
        display: none;
        flex: 1;
        flex-direction: column;
        min-height: 0;
      }
      .owf-panel.active {
        display: flex;
      }
      .owf-toolbar {
        padding: 12px 20px;
        border-bottom: 1px solid #21262d;
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        background: #0d1117;
        flex-shrink: 0;
      }
      .owf-search {
        flex: 1;
        min-width: 160px;
        background: #010409;
        color: #c9d1d9;
        border: 1px solid #30363d;
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 13px;
        outline: none;
      }
      .owf-search:focus {
        border-color: #1f6feb;
      }
      .owf-btn {
        background: #21262d;
        color: #c9d1d9;
        border: 1px solid #30363d;
        border-radius: 6px;
        padding: 7px 14px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        white-space: nowrap;
      }
      .owf-btn:hover {
        background: #30363d;
        border-color: #8b949e;
      }
      .owf-btn.primary {
        background: #238636;
        border-color: #238636;
        color: #ffffff;
      }
      .owf-btn.primary:hover {
        background: #2ea043;
        border-color: #2ea043;
      }
      .owf-btn.primary:disabled {
        background: #21262d;
        border-color: #30363d;
        color: #484f58;
        cursor: not-allowed;
      }
      .owf-btn.danger {
        background: #da3633;
        border-color: #da3633;
        color: #ffffff;
        font-size: 12px;
        padding: 4px 10px;
      }
      .owf-btn.danger:hover {
        background: #f85149;
        border-color: #f85149;
      }
      .owf-btn.danger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .owf-btn.danger-outline {
        background: transparent;
        border-color: #da3633;
        color: #f85149;
      }
      .owf-btn.danger-outline:hover {
        background: rgba(218, 54, 51, 0.15);
        border-color: #f85149;
      }
      .owf-btn.danger-outline:disabled {
        background: #21262d;
        border-color: #30363d;
        color: #484f58;
        cursor: not-allowed;
      }
      .owf-list {
        flex: 1;
        overflow-y: auto;
        padding: 4px 0;
        min-height: 280px;
        max-height: 420px;
      }
      .owf-list::-webkit-scrollbar {
        width: 10px;
      }
      .owf-list::-webkit-scrollbar-thumb {
        background: #30363d;
        border-radius: 5px;
      }
      .owf-card {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 14px 20px;
        border-bottom: 1px solid #21262d;
        cursor: pointer;
        transition: background 0.1s;
      }
      .owf-card:hover {
        background: #161b22;
      }
      .owf-card.selected {
        background: rgba(35, 134, 54, 0.08);
      }
      .owf-card input[type="checkbox"] {
        width: 18px;
        height: 18px;
        margin-top: 6px;
        cursor: pointer;
        accent-color: #238636;
        flex-shrink: 0;
      }
      .owf-avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 1px solid #30363d;
        background: #21262d;
        flex-shrink: 0;
        object-fit: cover;
      }
      .owf-info {
        flex: 1;
        min-width: 0;
      }
      .owf-info .owf-login {
        font-size: 15px;
        font-weight: 600;
        color: #58a6ff;
        text-decoration: none;
        font-family: ui-monospace, monospace;
      }
      .owf-info .owf-login:hover {
        text-decoration: underline;
      }
      .owf-info .owf-name {
        font-size: 13px;
        color: #c9d1d9;
        margin-top: 1px;
      }
      .owf-info .owf-bio {
        font-size: 12px;
        color: #8b949e;
        margin-top: 4px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .owf-meta {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        margin-top: 6px;
        font-size: 12px;
        color: #8b949e;
      }
      .owf-meta span {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .owf-meta strong {
        color: #c9d1d9;
        font-weight: 500;
      }
      .owf-loading {
        color: #484f58;
        font-style: italic;
        font-size: 13px;
      }
      .owf-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        margin-top: 4px;
      }
      .owf-empty {
        padding: 60px 20px;
        text-align: center;
        color: #8b949e;
      }
      .owf-footer {
        padding: 14px 20px;
        border-top: 1px solid #21262d;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        background: #161b22;
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .owf-count {
        color: #8b949e;
        font-size: 13px;
      }
      .owf-count strong {
        color: #3fb950;
      }
      .owf-footer-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .owf-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #238636;
        color: #ffffff;
        padding: 12px 24px;
        border-radius: 8px;
        font: 13px -apple-system, sans-serif;
        z-index: 2147483648;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        animation: owf-fade 0.3s ease;
        max-width: 90vw;
      }
      .owf-toast.warn {
        background: #9e6a03;
      }
      .owf-toast.error {
        background: #da3633;
      }
      @keyframes owf-fade {
        from { opacity: 0; transform: translate(-50%, 10px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      .owf-progress {
        height: 3px;
        background: #21262d;
        overflow: hidden;
        flex-shrink: 0;
      }
      .owf-progress-bar {
        height: 100%;
        background: #238636;
        width: 0%;
        transition: width 0.2s ease;
      }
    `;
    document.head.appendChild(style);
  }

  function showToast(message, type = '') {
    const element = document.createElement('div');
    element.className = 'owf-toast' + (type ? ' ' + type : '');
    element.textContent = message;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 4000);
  }

  // ============================================================
  // TAB OPENING
  // ============================================================

  function openSelectedTabs(urls, onComplete) {
    let opened = 0;
    let blocked = 0;
    urls.forEach((url, index) => {
      setTimeout(() => {
        const newWindow = window.open(url, '_blank');
        if (newWindow) opened++;
        else blocked++;
        if (index === urls.length - 1) {
          setTimeout(() => {
            if (blocked > 0) {
              showToast(
                `${opened} tab(s) opened, ${blocked} blocked. Allow pop-ups for github.com.`,
                'warn'
              );
            } else {
              showToast(`${opened} tab(s) opened successfully.`);
            }
            if (onComplete) onComplete({ opened, blocked });
          }, 150);
        }
      }, index * TAB_DELAY_MS);
    });
  }

  // ============================================================
  // MODAL
  // ============================================================

  function buildModal(users1, users2, profilesMap) {
    injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'owf-overlay';

    const modal = document.createElement('div');
    modal.id = 'owf-modal';

    // Header
    const header = document.createElement('div');
    header.id = 'owf-header';
    const title = document.createElement('h2');
    title.textContent = 'Follow analysis';
    header.appendChild(title);
    const closeButton = document.createElement('button');
    closeButton.id = 'owf-close';
    closeButton.textContent = '\u2715';
    closeButton.addEventListener('click', () => overlay.remove());
    header.appendChild(closeButton);

    // Tabs
    const tabs = document.createElement('div');
    tabs.id = 'owf-tabs';

    function makeTab(label, count, isActive) {
      const tab = document.createElement('button');
      tab.className = 'owf-tab' + (isActive ? ' active' : '');
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      tab.appendChild(labelSpan);
      const countSpan = document.createElement('span');
      countSpan.className = 'owf-tab-count';
      countSpan.textContent = String(count);
      tab.appendChild(countSpan);
      return tab;
    }

    const tab1 = makeTab('Not following back', users1.length, true);
    const tab2 = makeTab('Not followed back', users2.length, false);
    tabs.appendChild(tab1);
    tabs.appendChild(tab2);

    // Panel 1 (unfollow mode)
    const panel1 = buildPanel('unfollow', users1, profilesMap, tab1, true);
    // Panel 2 (follow mode)
    const panel2 = buildPanel('follow', users2, profilesMap, tab2, false);

    function activate(which) {
      const isTab1 = which === 1;
      tab1.classList.toggle('active', isTab1);
      tab2.classList.toggle('active', !isTab1);
      panel1.panel.classList.toggle('active', isTab1);
      panel2.panel.classList.toggle('active', !isTab1);
    }
    tab1.addEventListener('click', () => activate(1));
    tab2.addEventListener('click', () => activate(2));

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.addEventListener('keydown', function onEscape(event) {
      if (event.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onEscape);
      }
    });

    modal.appendChild(header);
    modal.appendChild(tabs);
    modal.appendChild(panel1.panel);
    modal.appendChild(panel2.panel);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    return {
      updateProfile(name, profile) {
        profilesMap.set(name, profile);
        panel1.updateProfile(name, profile);
        panel2.updateProfile(name, profile);
      },
      setProgress(loaded, total) {
        panel1.setProgress(loaded, total);
        panel2.setProgress(loaded, total);
      },
    };
  }

  // ============================================================
  // PANEL
  // ============================================================

  function buildPanel(mode, users, profilesMap, tabElement, isActive) {
    const panel = document.createElement('div');
    panel.className = 'owf-panel' + (isActive ? ' active' : '');

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'owf-toolbar';
    const searchInput = document.createElement('input');
    searchInput.className = 'owf-search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search by username or name';
    toolbar.appendChild(searchInput);
    const filterButton = document.createElement('button');
    filterButton.className = 'owf-btn';
    filterButton.type = "button";
    filterButton.setAttribute('aria-label', 'Filter');
    filterButton.title = 'Filter';

    filterButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
        <line x1="2" y1="4" x2="14" y2="4"/>
        <line x1="2" y1="8" x2="14" y2="8"/>
        <line x1="2" y1="12" x2="14" y2="12"/>
        <circle cx="5" cy="4" r="1.75" fill="currentColor" stroke="none"/>
        <circle cx="11" cy="8" r="1.75" fill="currentColor" stroke="none"/>
        <circle cx="7" cy="12" r="1.75" fill="currentColor" stroke="none"/>
      </svg>
    `;
    toolbar.appendChild(filterButton);
    const selectAllButton = document.createElement('button');
    selectAllButton.className = 'owf-btn';
    selectAllButton.textContent = 'Select All';
    toolbar.appendChild(selectAllButton);
    
    const selectNoneButton = document.createElement('button');
    selectNoneButton.className = 'owf-btn';
    selectNoneButton.textContent = 'Clear';        

    toolbar.appendChild(selectNoneButton);
    panel.appendChild(toolbar);

    // Progress bar
    const progressContainer = document.createElement('div');
    progressContainer.className = 'owf-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'owf-progress-bar';
    progressContainer.appendChild(progressBar);
    panel.appendChild(progressContainer);

    // List
    const list = document.createElement('div');
    list.className = 'owf-list';
    panel.appendChild(list);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'owf-footer';
    const countLabel = document.createElement('div');
    countLabel.className = 'owf-count';
    footer.appendChild(countLabel);
    const footerActions = document.createElement('div');
    footerActions.className = 'owf-footer-actions';

    const actionButton = document.createElement('button');
    actionButton.className = 'owf-btn danger-outline';
    actionButton.disabled = true;
    footerActions.appendChild(actionButton);

    const openButton = document.createElement('button');
    openButton.className = 'owf-btn primary';
    openButton.textContent = 'Open Selected';
    openButton.disabled = true;
    footerActions.appendChild(openButton);

    footer.appendChild(footerActions);
    panel.appendChild(footer);

    // State
    const selectedSet = new Set();
    const removedSet = new Set();
    let isBulkRunning = false;

    function getActiveUsers() {
      return users.filter((username) => !removedSet.has(username));
    }

    function updateCountLabel() {
      let count = 0;
      for (const username of selectedSet) {
        if (!removedSet.has(username)) count++;
      }
      const activeTotal = getActiveUsers().length;
      countLabel.textContent = `Selected: ${count} of ${activeTotal}`;
      const busy = isBulkRunning;
      openButton.disabled = count === 0 || busy;
      openButton.textContent = count > 0 ? `Open ${count} Tab(s)` : 'Open Selected';
      actionButton.disabled = count === 0 || busy;
      if (mode === 'unfollow') {
        actionButton.textContent = count > 0 ? `Unfollow ${count}` : 'Unfollow Selected';
      } else {
        actionButton.textContent = count > 0 ? `Follow ${count}` : 'Follow Selected';
      }
      // Update tab count badge
      if (tabElement) {
        tabElement.querySelector('.owf-tab-count').textContent = String(activeTotal);
      }
    }

    function createMetaSpan(label, value) {
      const span = document.createElement('span');
      span.innerHTML = `${label}: <strong>${value}</strong>`;
      return span;
    }

    function createMetaTextSpan(label, value) {
      const span = document.createElement('span');
      span.textContent = `${label}: ${value}`;
      return span;
    }

    function renderList(filter = '') {
      list.innerHTML = '';
      const query = filter.trim().toLowerCase();
      let shownCount = 0;

      for (const username of getActiveUsers()) {
        const profile = profilesMap.get(username) || { login: username, loading: true };
        const haystack = `${username} ${profile.name || ''}`.toLowerCase();
        if (query && !haystack.includes(query)) continue;
        shownCount++;

        const card = document.createElement('div');
        card.className = 'owf-card' + (selectedSet.has(username) ? ' selected' : '');
        card.dataset.username = username;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedSet.has(username);
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedSet.add(username);
          else selectedSet.delete(username);
          card.classList.toggle('selected', checkbox.checked);
          updateCountLabel();
        });
        card.appendChild(checkbox);

        const avatar = document.createElement('img');
        avatar.className = 'owf-avatar';
        if (profile.avatar) {
          avatar.src = profile.avatar;
          avatar.alt = username;
          avatar.loading = 'lazy';
        }
        card.appendChild(avatar);

        const info = document.createElement('div');
        info.className = 'owf-info';

        const loginLink = document.createElement('a');
        loginLink.className = 'owf-login';
        loginLink.href = profile.htmlUrl || `https://github.com/${username}`;
        loginLink.target = '_blank';
        loginLink.rel = 'noopener';
        loginLink.textContent = username;
        loginLink.addEventListener('click', (event) => event.stopPropagation());
        info.appendChild(loginLink);

        if (profile.loading) {
          const loading = document.createElement('div');
          loading.className = 'owf-loading';
          loading.textContent = 'Loading profile...';
          info.appendChild(loading);
        } else if (profile.error) {
          const error = document.createElement('div');
          error.className = 'owf-loading';
          error.textContent = profile.error;
          info.appendChild(error);
        } else {
          if (profile.name) {
            const nameElement = document.createElement('div');
            nameElement.className = 'owf-name';
            nameElement.textContent = profile.name;
            info.appendChild(nameElement);
          }
          if (profile.bio) {
            const bioElement = document.createElement('div');
            bioElement.className = 'owf-bio';
            bioElement.textContent = profile.bio;
            info.appendChild(bioElement);
          }
          const meta = document.createElement('div');
          meta.className = 'owf-meta';
          meta.appendChild(createMetaSpan('Repos', profile.publicRepos));
          meta.appendChild(createMetaSpan('Followers', profile.followers));
          meta.appendChild(createMetaSpan('Following', profile.following));
          if (profile.location) meta.appendChild(createMetaTextSpan('Location', profile.location));
          if (profile.company) meta.appendChild(createMetaTextSpan('Company', profile.company));
          info.appendChild(meta);
        }

        card.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'owf-actions';
        const singleButton = document.createElement('button');
        singleButton.className = 'owf-btn danger';
        singleButton.textContent = mode === 'unfollow' ? 'Unfollow' : 'Follow';
        singleButton.title = GITHUB_TOKEN
          ? (mode === 'unfollow' ? 'Unfollow this user via the GitHub API' : 'Follow this user via the GitHub API')
          : 'Requires a Personal Access Token with the user:follow scope';
        singleButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          singleButton.disabled = true;
          singleButton.textContent = '...';
          try {
            if (mode === 'unfollow') await unfollowUser(username);
            else await followUser(username);
            removedSet.add(username);
            selectedSet.delete(username);
            showToast(`${mode === 'unfollow' ? 'Unfollowed' : 'Followed'} ${username}`);
            renderList(searchInput.value);
            updateCountLabel();
          } catch (error) {
            showToast(error.message || 'Action failed', 'error');
            singleButton.disabled = false;
            singleButton.textContent = mode === 'unfollow' ? 'Unfollow' : 'Follow';
          }
        });
        actions.appendChild(singleButton);
        card.appendChild(actions);

        card.addEventListener('click', (event) => {
          if (event.target.closest('a') || event.target.closest('button') || event.target === checkbox) return;
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) selectedSet.add(username);
          else selectedSet.delete(username);
          card.classList.toggle('selected', checkbox.checked);
          updateCountLabel();
        });

        list.appendChild(card);
      }

      if (shownCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'owf-empty';
        empty.textContent = query
          ? 'No accounts match your search.'
          : (mode === 'unfollow' ? 'No one-way follows found.' : 'No one-way followers found.');
        list.appendChild(empty);
      }
    }

    selectAllButton.addEventListener('click', () => {
      const query = searchInput.value.trim().toLowerCase();
      for (const username of getActiveUsers()) {
        const profile = profilesMap.get(username) || { login: username };
        const haystack = `${username} ${profile.name || ''}`.toLowerCase();
        if (!query || haystack.includes(query)) selectedSet.add(username);
      }
      renderList(searchInput.value);
      updateCountLabel();
    });

    selectNoneButton.addEventListener('click', () => {
      selectedSet.clear();
      renderList(searchInput.value);
      updateCountLabel();
    });

    searchInput.addEventListener('input', () => renderList(searchInput.value));

    openButton.addEventListener('click', () => {
      const selected = getActiveUsers().filter((username) => selectedSet.has(username));
      if (selected.length === 0) return;
      const urls = selected.map((username) => {
        const profile = profilesMap.get(username);
        return profile && profile.htmlUrl ? profile.htmlUrl : `https://github.com/${username}`;
      });
      openButton.disabled = true;
      openButton.textContent = 'Opening...';
      openSelectedTabs(urls, (result) => {
        openButton.disabled = false;
        openButton.textContent = result.blocked === 0 ? 'Open Selected' : 'Retry';
      });
    });

    actionButton.addEventListener('click', async () => {
      if (isBulkRunning) return;
      const selected = getActiveUsers().filter((username) => selectedSet.has(username));
      if (selected.length === 0) return;

      const verb = mode === 'unfollow' ? 'Unfollow' : 'Follow';
      const confirmed = window.confirm(
        `${verb} ${selected.length} account(s)? This cannot be undone from this dialog.`
      );
      if (!confirmed) return;

      isBulkRunning = true;
      actionButton.disabled = true;
      openButton.disabled = true;
      actionButton.textContent = `${verb}ing...`;

      let succeeded = 0;
      let failed = 0;

      for (let index = 0; index < selected.length; index++) {
        const username = selected[index];
        try {
          if (mode === 'unfollow') await unfollowUser(username);
          else await followUser(username);
          succeeded++;
          removedSet.add(username);
          selectedSet.delete(username);
        } catch (error) {
          failed++;
          console.warn(`${verb} failed for ${username}: ${error.message}`);
        }
        countLabel.textContent = `${verb}ing ${index + 1} of ${selected.length} (ok: ${succeeded}, failed: ${failed})`;
        renderList(searchInput.value);
        if (index < selected.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, UNFOLLOW_DELAY_MS));
        }
      }

      isBulkRunning = false;
      renderList(searchInput.value);
      updateCountLabel();

      if (failed === 0) {
        showToast(`${verb}ed ${succeeded} account(s).`);
      } else {
        showToast(`${verb}ed ${succeeded}, failed ${failed}. See console.`, 'warn');
      }
    });

    renderList();
    updateCountLabel();

    return {
      panel,
      setProgress(loaded, total) {
        progressBar.style.width = (total > 0 ? (loaded / total) * 100 : 0) + '%';
      },
      updateProfile(username, profile) {
        profilesMap.set(username, profile);
        if (!removedSet.has(username)) renderList(searchInput.value);
      },
    };
  }

  // ============================================================
  // MAIN
  // ============================================================

  try {
    const username = extractUsername();
    if (!username) {
      console.error('This page is not a GitHub user profile.');
      showToast('This page is not a GitHub user profile.', 'error');
      return;
    }

    console.log(`Analyzing follows for: ${username}`);
    if (!GITHUB_TOKEN) {
      console.warn(
        'No Personal Access Token provided. Unauthenticated requests are limited to 60 per hour, and follow/unfollow actions will not work.'
      );
    }

    console.log('Fetching following list');
    const following = await getAllPages(username, 'following');
    console.log(`Following count: ${following.length}`);

    console.log('Fetching followers list');
    const followers = await getAllPages(username, 'followers');
    console.log(`Follower count: ${followers.length}`);

    const followingSet = new Set(following.map((name) => name.toLowerCase()));
    const followersSet = new Set(followers.map((name) => name.toLowerCase()));

    const notFollowingBack = following
      .filter((name) => !followersSet.has(name.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    const notFollowedBack = followers
      .filter((name) => !followingSet.has(name.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    console.log(`Not following back: ${notFollowingBack.length}`);
    console.log(`Not followed back: ${notFollowedBack.length}`);

    window.oneWayFollowingResults = notFollowingBack;
    window.oneWayFollowersResults = notFollowedBack;

    if (notFollowingBack.length === 0 && notFollowedBack.length === 0) {
      showToast('No one-way follows or one-way followers found.');
      return;
    }

    // Shared profiles map across both lists
    const profilesMap = new Map();
    const allUsers = new Set([...notFollowingBack, ...notFollowedBack]);
    for (const name of allUsers) {
      profilesMap.set(name, { login: name, loading: true });
    }

    const modalHelpers = buildModal(notFollowingBack, notFollowedBack, profilesMap);

    console.log('Fetching full profiles');
    const allUsersArray = Array.from(allUsers);
    let loaded = 0;
    let failed = 0;

    for (let index = 0; index < allUsersArray.length; index += BATCH_SIZE) {
      const batch = allUsersArray.slice(index, index + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((name) => fetchProfile(name)));
      results.forEach((result, offset) => {
        const name = batch[offset];
        if (result.status === 'fulfilled') {
          profilesMap.set(name, result.value);
          loaded++;
        } else {
          profilesMap.set(name, { login: name, error: 'Failed to fetch profile' });
          failed++;
        }
        modalHelpers.updateProfile(name, profilesMap.get(name));
        modalHelpers.setProgress(loaded + failed, allUsersArray.length);
      });
      console.log(`Profiles loaded: ${loaded + failed}/${allUsersArray.length} (${failed} failed)`);
      if (index + BATCH_SIZE < allUsersArray.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    console.log(`Profile loading complete. Loaded: ${loaded}, failed: ${failed}`);
    if (failed > 0) showToast(`${loaded} profiles loaded, ${failed} failed.`, 'warn');
  } catch (error) {
    console.error(error.message || error);
    showToast(error.message || 'An unexpected error occurred.', 'error');
  }
})();
