import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Reliable Tab-trap for AlertDialog/Dialog content — works around a FocusScope loop
// regression in @radix-ui/react-focus-scope@1.1.7 where Tab from the last tabbable
// element lands on the tabIndex:-1 container instead of wrapping to the first element.
// Add as onKeyDown on AlertDialogContent / DialogContent; runs before FocusScope's
// own handler so focus is already correct by the time FocusScope checks activeElement.
export function trapDialogTab(e: {
  key: string;
  shiftKey: boolean;
  currentTarget: HTMLElement;
  preventDefault(): void;
}): void {
  if (e.key !== 'Tab') return;
  const container = e.currentTarget;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  });
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
