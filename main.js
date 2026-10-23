(async function () {
  'use strict';

  // ===== تنظیمات =====
  const GITHUB_TOKEN = ''; // توکن PAT اختیاری برای جلوگیری از Rate Limit

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
      `راه‌حل: یک توکن PAT در GITHUB_TOKEN قرار بده.`
    );
  }

  async function getAllPages(username, endpoint) {
    const all = [];
    let page = 1;
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
      console.log(`  → ${endpoint}: صفحه ${page} (${all.length} مورد)`);
      const link = response.headers.get('Link');
      if (!link || !/rel="next"/.test(link)) break;
      page++;
    }
    return all;
  }

  function extractUsername() {
    const match = window.location.href.match(/^https?:\/\/github\.com\/([^\/?#]+)/i);
    if (!match || !match[1]) return null;
    const candidate = decodeURIComponent(match[1]);
    if (RESERVED_PATHS.has(candidate.toLowerCase())) return null;
    if (candidate.startsWith('@')) return candidate.slice(1);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(candidate)) return null;
    return candidate;
  }

  function downloadCsv(users) {
    const header = 'username,profile_url\n';
    const rows = users.map((u) => `${u},https://github.com/${u}`).join('\n');
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

  // ===== باز کردن تب‌ها =====
  function openTabs(users, delayMs = 250) {
    const total = users.length;
    console.log(`\n🚀 در حال باز کردن ${total} تب...`);
    users.forEach((user, i) => {
      setTimeout(() => {
        const win = window.open(`https://github.com/${user}`, '_blank');
        if (!win) {
          console.warn(`⚠️ تب ${i + 1} (${user}) باز نشد — احتمالاً pop-up blocker فعاله.`);
        } else {
          console.log(`  ${i + 1}/${total} → ${user}`);
        }
      }, i * delayMs);
    });
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
      console.warn('⚠️ بدون توکن PAT — احتمال برخورد با Rate Limit.');
    }

    console.log('📥 دریافت following...');
    const following = await getAllPages(username, 'following');
    console.log(`✅ following: ${following.length}`);

    console.log('📥 دریافت followers...');
    const followers = await getAllPages(username, 'followers');
    console.log(`✅ followers: ${followers.length}`);

    const followerSet = new Set(followers.map((u) => u.toLowerCase()));
    const oneWayFollowing = following
      .filter((u) => !followerSet.has(u.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    console.log('\n📊 نتایج:');
    console.log(`تعداد فالوهای یک‌طرفه: ${oneWayFollowing.length}`);

    if (oneWayFollowing.length === 0) {
      console.log('🎉 هیچ فالوی یک‌طرفه‌ای یافت نشد!');
      return;
    }

    oneWayFollowing.forEach((user, i) => {
      console.log(`${i + 1}. ${user} - https://github.com/${user}`);
    });

    window.oneWayFollowingResults = oneWayFollowing;
    downloadCsv(oneWayFollowing);
    console.log('\n💾 CSV دانلود شد: one-way-following.csv');
    console.log('💡 لیست در window.oneWayFollowingResults ذخیره شد.');

    // ===== پرسش از کاربر =====
    console.log('\n─────────────────────────────');
    const input = window.prompt(
      `تعداد فالوهای یک‌طرفه: ${oneWayFollowing.length}\n\n` +
      `چند تا از آخرین پروفایل‌ها رو در تب جدید باز کنم؟\n` +
      `(عددی بین 0 تا ${oneWayFollowing.length} وارد کن — برای انصراف خالی بذار)`,
      '0'
    );

    if (input === null || input.trim() === '') {
      console.log('⏹️ انصراف داده شد. هیچ تبی باز نشد.');
      return;
    }

    const count = parseInt(input.trim(), 10);
    if (isNaN(count) || count < 0) {
      console.error('❌ ورودی نامعتبر. باید یک عدد صحیح باشد.');
      return;
    }
    if (count === 0) {
      console.log('⏹️ عدد صفر وارد شد. هیچ تبی باز نشد.');
      return;
    }
    if (count > oneWayFollowing.length) {
      console.warn(`⚠️ عدد وارد شده (${count}) از تعداد کل (${oneWayFollowing.length}) بیشتره. همه باز می‌شن.`);
    }

    const n = Math.min(count, oneWayFollowing.length);
    const lastN = oneWayFollowing.slice(-n); // ← n مورد آخر لیست

    console.log(`\n📌 ${n} پروفایل آخر لیست:`);
    lastN.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

    // هشدار pop-up
    console.log('\n💡 نکته: اگر مرورگر تب‌ها رو باز نکرد، pop-up blocker رو برای این سایت غیرفعال کن.');
    console.log('   (Chrome: آیکون قفل/تنظیمات کنار نوار آدرس → Site settings → Pop-ups and redirects → Allow)');

    openTabs(lastN, 250);
  } catch (error) {
    console.error('❌ خطا:', error.message || error);
  }
})();
