export function getCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(
      "(^|; )" + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "=([^;]*)",
    ),
  );
  return match ? decodeURIComponent(match[2]) : null;
}

export function setCookie(name: string, value: string) {
  // 1 year, Lax, root path
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

export function getJsonCookie<T>(name: string, fallback: T): T {
  try {
    const raw = getCookie(name);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJsonCookie(name: string, value: unknown) {
  try {
    setCookie(name, JSON.stringify(value));
  } catch {
    // ignore
  }
}
