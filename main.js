(async function() {
    // Test?
  // تابع برای دریافت لیست فالووینگ‌ها
  async function getFollowing(username) {
    let following = [];
    let page = 1;
    let hasNext = true;
    
    while (hasNext) {
      const response = await fetch(`https://api.github.com/users/${username}/following?page=${page}&per_page=100`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`خطا در دریافت فالووینگ‌ها: ${response.status}`);
      }
      
      const data = await response.json();
      following = following.concat(data.map(user => user.login));
      
      // بررسی وجود صفحه بعدی
      const linkHeader = response.headers.get('Link');
      hasNext = linkHeader && linkHeader.includes('rel="next"');
      page++;
    }
    
    return following;
  }

  // تابع برای دریافت لیست فالوورها
  async function getFollowers(username) {
    let followers = [];
    let page = 1;
    let hasNext = true;
    
    while (hasNext) {
      const response = await fetch(`https://api.github.com/users/${username}/followers?page=${page}&per_page=100`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`خطا در دریافت فالوورها: ${response.status}`);
      }
      
      const data = await response.json();
      followers = followers.concat(data.map(user => user.login));
      
      // بررسی وجود صفحه بعدی
      const linkHeader = response.headers.get('Link');
      hasNext = linkHeader && linkHeader.includes('rel="next"');
      page++;
    }
    
    return followers;
  }

  try {
    // دریافت نام کاربری از URL فعلی
    const currentUrl = window.location.href;
    const usernameMatch = currentUrl.match(/github\.com\/([^\/]+)/);
    
    if (!usernameMatch || !usernameMatch[1]) {
      console.error('نام کاربری GitHub یافت نشد.');
      return;
    }
    
    const username = usernameMatch[1];
    console.log(`در حال بررسی فالوهای یکطرفه برای کاربر: ${username}`);
    
    // دریافت لیست‌ها
    console.log('در حال دریافت لیست افرادی که شما فالو کرده‌اید...');
    const following = await getFollowing(username);
    console.log(`تعداد افرادی که شما فالو کرده‌اید: ${following.length}`);
    
    console.log('در حال دریافت لیست افرادی که شما را فالو کرده‌اند...');
    const followers = await getFollowers(username);
    console.log(`تعداد افرادی که شما را فالو کرده‌اند: ${followers.length}`);
    
    // پیدا کردن فالوهای یکطرفه
    const oneWayFollowing = following.filter(user => !followers.includes(user));
    
    console.log('\nنتایج:');
    console.log(`تعداد فالوهای یکطرفه (شما آنها را فالو کرده‌اید اما آنها شما را فالو نکرده‌اند): ${oneWayFollowing.length}`);
    
    if (oneWayFollowing.length > 0) {
      console.log('\nلیست کاربرانی که شما آنها را فالو کرده‌اید اما آنها شما را فالو نکرده‌اند:');
      oneWayFollowing.forEach((user, index) => {
        console.log(`${index + 1}. ${user} - https://github.com/${user}`);
      });
      
      // ذخیره نتایج در یک متغیر جهانی برای دسترسی آسان
      window.oneWayFollowingResults = oneWayFollowing;
      console.log('\nنتایج در متغیر global `oneWayFollowingResults` نیز ذخیره شدند.');
    } else {
      console.log('هیچ فالوی یکطرفه‌ای یافت نشد! همه افرادی که شما فالو کرده‌اید، شما را نیز فالو کرده‌اند.');
    }
  } catch (error) {
    console.error('خطا در اجرای اسکریپت:', error);
  }
})();
