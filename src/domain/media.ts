// Shared Google Photos album. Google Photos blocks iframe embedding
// (X-Frame-Options), so this opens in a new tab rather than embedding.
// The account-specific `/u/1/` prefix and tracking params are stripped so the
// link resolves for whichever caregiver opens it.
export const PHOTO_ALBUM_URL =
  'https://photos.google.com/share/AF1QipMMRl0Ho98BK647OCfMw4y5i8gQeWafY6bocSN4zs8hGCo-jgwnxsGrOiFWfwXNpg?key=a2pmTUR5SExCVXgyOU5VdjMwdUNSVFpLZU5KXzNB';
