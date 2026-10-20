// Public demo: the guest account every "Check out a demo project" visitor shares
// (server: DEMO_GUEST_ID in storage.ts), and the one-time welcome dialog flag.

export const DEMO_GUEST_ID = "demo-guest";

// sessionStorage, so it belongs to this tab only and a new demo login sets it again.
const DEMO_WELCOME_KEY = "patchbay-demo-welcome";

export function markDemoWelcomePending(): void {
  try {
    sessionStorage.setItem(DEMO_WELCOME_KEY, "pending");
  } catch {
    // Storage blocked — the visitor just doesn't get the welcome.
  }
}

export function isDemoWelcomePending(): boolean {
  try {
    return sessionStorage.getItem(DEMO_WELCOME_KEY) === "pending";
  } catch {
    return false;
  }
}

export function clearDemoWelcome(): void {
  try {
    sessionStorage.removeItem(DEMO_WELCOME_KEY);
  } catch {
    // Nothing to clear.
  }
}
