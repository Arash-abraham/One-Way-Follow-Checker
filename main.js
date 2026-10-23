(async function () {
  'use strict';

  // ===== تنظیمات =====
  // برای جلوگیری از Rate Limit (۶۰ درخواست/ساعت بدون توکن)، توکن PAT خودت رو اینجا بذار.
  // توکن رو از https://github.com/settings/tokens بساز (بدون هیچ scope‌ای هم کافیه).
  const GITHUB_TOKEN = ''; // مثلاً 'ghp_xxxxxxxxxxxxxxxxxxxx'

  const RESERVED_PATHS = new Set([
    'orgs', 'settings', 'explore', 'features', 'topics', 'marketplace',
    'login', 'join', 'about', 'pricing', 'sponsors', 'trending',
    'collections', 'events', 'notifications', 'pulls', 'issues',
    'search', 'new', 'organizations', 'users', 'apps', 'codespaces',
  ]);

  // ===== ابزارها =====
  function buildHeaders() {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    return headers;
  }

  async function handleRateLimit(response) {
    if (response.status !== 403 && response.status !== 429) return;
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining !== '0') return;

    const reset = response.headers.get('X-RateLimit-Reset');
    const resetTime = reset
      ? new Date(Number(reset) * 1000).toLocaleTimeString('fa-IR')
      : 'نامشخص';

    throw new Error(
      `محدودیت درخواست GitHub فعال شد. زمان ریست: ${resetTime}\n` +
      `راه‌حل: یک توکن PAT در متغیر GITHUB_TOKEN قرار بده.`
    );
  }

  // دریافت همه‌ی صفحات یک endpoint (following یا followers)
  async function getAllPages(username, endpoint) {
    const all = [];
    let page = 1;
    let total = null;

    while (true) {
      const url = `https://api.github.com/users/${encodeURIComponent(username)}/${endpoint}?page=${page}&per_page=100`;
      const response = await fetch(url, { headers: buildHeaders() });

      if (!response.ok) {
        await handleRateLimit(response);
        throw new Error(`خطا در دریافت ${endpoint} (صفحه ${page}): ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) break;

      all.push(...data.map((u) => u.login));

      // نمایش پیشرفت
      if (total === null && endpoint === 'followers') {
        // فقط یک‌بار تلاش برای گرفتن تعداد کل (هدر Link هم می‌تونه کمک کنه)
      }
      console.log(`  → ${endpoint}: صفحه ${page} دریافت شد (${all.length} مورد تا الان)`);

      const link = response.headers.get('Link');
      const hasNext = link && /rel="next"/.test(link);
      if (!hasNext) break;
      page++;
    }

    return all;
  }

  // ===== تشخیص نام کاربری =====
  function extractUsername() {
    const match = window.location.href.match(/^https?:\/\/github\.com\/([^\/?#]+)/i);
    if (!match || !match[1]) return null;

    const candidate = decodeURIComponent(match[1]);

    if (RESERVED_PATHS.has(candidate.toLowerCase())) return null;
    if (candidate.startsWith('@')) return candidate.slice(1);
    // نام‌های کاربری معتبر گیت‌هاب: حروف، اعداد، خط تیره (حداکثر ۳۹ کاراکتر)
    if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(candidate)) return null;

    return candidate;
  }

  // ===== خروجی CSV =====
  function downloadCsv(users) {
    const header = 'username,profile_url\n';
    const rows = users
      .map((u) => `${u},https://github.com/${u}`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'one-way-following.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ===== اجرا =====
  try {
    const username = extractUsername();
    if (!username) {
      console.error('❌ صفحه‌ی فعلی یک پروفایل کاربری GitHub نیست.');
      return;
    }

    console.log(`🔍 بررسی فالوهای یک‌طرفه برای: ${username}`);
    if (!GITHUB_TOKEN) {
      console.warn('⚠️ بدون توکن PAT اجرا می‌شود — احتمال برخورد با Rate Limit وجود دارد.');
    }

    console.log('📥 دریافت لیست following...');
    const following = await getAllPages(username, 'following');
    console.log(`✅ following: ${following.length} کاربر`);

    console.log('📥 دریافت لیست followers...');
    const followers = await getAllPages(username, 'followers');
    console.log(`✅ followers: ${followers.length} کاربر`);

    // مقایسه‌ی case-insensitive با Set برای کارایی
    const followerSet = new Set(followers.map((u) => u.toLowerCase()));
    const oneWayFollowing = following
      .filter((u) => !followerSet.has(u.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    console.log('\n📊 نتایج:');
    console.log(`تعداد فالوهای یک‌طرفه (شما فالو کرده‌اید، آن‌ها شما را نه): ${oneWayFollowing.length}`);

    if (oneWayFollowing.length > 0) {
      console.log('\n📋 لیست:');
      oneWayFollowing.forEach((user, i) => {
        console.log(`${i + 1}. ${user} - https://github.com/${user}`);
      });

      // ذخیره در متغیر جهانی برای دسترسی دستی
      window.oneWayFollowingResults = oneWayFollowing;

      // دانلود CSV
      downloadCsv(oneWayFollowing);
      console.log('\n💾 فایل CSV دانلود شد: one-way-following.csv');
      console.log('💡 نتایج در window.oneWayFollowingResults هم ذخیره شدند.');
    } else {
      console.log('🎉 هیچ فالوی یک‌طرفه‌ای یافت نشد!');
    }
  } catch (error) {
    console.error('❌ خطا در اجرای اسکریپت:', error.message || error);
  }
})();
