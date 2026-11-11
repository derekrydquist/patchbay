import { describe, it, expect } from 'vitest';
import { confirmDialogTop } from './confirm-dialog-position';

const base = {
  dialogWidth: 384, dialogHeight: 180, viewportWidth: 1400, viewportHeight: 900,
  gapTop: 56, gapBottom: 456,
};

describe('confirmDialogTop', () => {
  it('centres the dialog in the gap between header and timeline', () => {
    expect(confirmDialogTop({ ...base, outline: { top: 600, bottom: 664, left: 500, right: 700 } }))
      .toBe((56 + 456) / 2 - 90);
  });

  it('centres in the gap when the outline is unknown', () => {
    expect(confirmDialogTop({ ...base, outline: null })).toBe(166);
  });

  it('keeps a short gap\'s centre when the dialog then misses the outline', () => {
    // gap 56–156 (100px) is shorter than the dialog; centred top = 16, bottom = 196
    const top = confirmDialogTop({ ...base, gapBottom: 156, outline: { top: 300, bottom: 364, left: 500, right: 700 } });
    expect(top).toBe(16);
  });

  it('moves above the outline when the centred spot would cover it', () => {
    // centred in 56–300: top 88, bottom 268 — over an outline starting at 250
    const outline = { top: 250, bottom: 314, left: 500, right: 900 };
    const top = confirmDialogTop({ ...base, gapTop: 56, gapBottom: 300, outline });
    expect(top + 180).toBeLessThanOrEqual(outline.top - 8);
    expect(top).toBe(250 - 8 - 180);
  });

  it('moves below the outline when there is no room above it', () => {
    const outline = { top: 120, bottom: 184, left: 500, right: 900 };
    const top = confirmDialogTop({ ...base, gapBottom: 200, outline });
    expect(top).toBe(184 + 8);
  });

  it('ignores an outline that is not under the dialog horizontally', () => {
    const outline = { top: 100, bottom: 164, left: 1300, right: 1390 };
    expect(confirmDialogTop({ ...base, outline })).toBe(166);
  });

  it('never goes above the window\'s top margin', () => {
    const top = confirmDialogTop({ ...base, viewportHeight: 200, gapTop: 0, gapBottom: 20, outline: null });
    expect(top).toBe(8);
  });
});
