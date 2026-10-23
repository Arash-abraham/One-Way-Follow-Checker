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