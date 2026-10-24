// Every call to the backend goes through `api`, so session handling lives in
// one place.
//
// Idle logoff (PRODUCT.md §7): the server ends a session 15 minutes after
// the last request. If the browser only learned about that on the next
// request, patient data would stay on screen indefinitely. So we run the
// same 15-minute clock here, reset on every request, and clear the screen
// when it runs out.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

let idleTimer;
let onSessionEnd = () => {};

// App registers what to do when the session ends ('idle' or 'expired').
export function setSessionEndHandler(handler) {
  onSessionEnd = handler;
}

export function stopIdleTimer() {
  clearTimeout(idleTimer);
}

function restartIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => onSessionEnd('idle'), IDLE_TIMEOUT_MS);
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

export async function api(method, path, { body, signal } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);

  if (response.status === 401 && path !== '/session') {
    // The server ended the session (e.g. idle timeout while the tab slept).
    stopIdleTimer();
    onSessionEnd('expired');
  }
  if (!response.ok) throw new ApiError(response.status, data);

  restartIdleTimer();
  return data;
}
