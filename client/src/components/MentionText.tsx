import React from 'react';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Renders comment text with @username mentions styled distinctly, matched
 * against the real band member list so a literal "@something" that isn't an
 * actual user renders as plain text. Shared by ClipInfoWindow, ReviewPlayer,
 * and Lyrics comments — the three surfaces with @ mention autocomplete —
 * so all three stay in sync with one rendering rule.
 */
export function MentionText({ text, usernames }: { text: string; usernames: string[] }) {
  if (usernames.length === 0 || !text) return <>{text}</>;

  const pattern = new RegExp(`@(${usernames.map(escapeRegExp).join('|')})\\b`, 'gi');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <span key={key++} className="font-bold text-primary">
        @{match[1]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  parts.push(text.slice(lastIndex));

  return <>{parts}</>;
}
