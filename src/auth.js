export const isDesktopShell = (userAgent = '') => /Electron\//i.test(userAgent);

export function openAuthorizationUrl(
  url,
  {
    userAgent = globalThis.navigator?.userAgent || '',
    location = globalThis.location,
    popup = null,
    openWindow = globalThis.open,
  } = {},
) {
  if (isDesktopShell(userAgent)) {
    location.assign(url);
    return 'system-browser';
  }
  if (popup) {
    popup.location.href = url;
    return 'popup';
  }
  openWindow?.(url, '_blank', 'noopener,noreferrer');
  return 'new-window';
}
