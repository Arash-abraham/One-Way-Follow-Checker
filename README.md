# GitHub One-Way Follow Checker

A browser console script that lists GitHub accounts you follow
without being followed back, and lets you unfollow them in bulk.

## Setup

1. Create a Personal Access Token at https://github.com/settings/tokens
   with the `user:follow` scope.
2. Open the script, set `GITHUB_TOKEN` at the top.
3. Navigate to your GitHub profile page.
4. Open the browser console and paste the script.

## Notes

- Unauthenticated requests are limited to 60 per hour. A token raises
  this to 5,000 per hour.
- To open more than a few tabs, allow pop-ups for github.com in your
  browser's site settings.
