import React from 'react';
import { ChevronDown, Magnet } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SNAP_UNITS, type SnapUnit } from '@/lib/musical-time';

// Snap for timeline clip drags: on/off and the grid unit. Personal, per browser and
// not per song — one localStorage key, never the database.
export interface SnapSetting {
  on: boolean;
  unit: SnapUnit;
}

const SNAP_STORAGE_KEY = 'patchbay-snap';
const DEFAULT_SNAP: SnapSetting = { on: true, unit: '1/4' };

const SNAP_LABELS: Record<SnapUnit, string> = { bar: 'Bar', '1/4': '1/4', '1/8': '1/8', '1/16': '1/16' };

// The stored setting, or 1/4 and on when it's missing or not a valid setting.
export function readSnapSetting(): SnapSetting {
  try {
    const raw = localStorage.getItem(SNAP_STORAGE_KEY);
    if (!raw) return DEFAULT_SNAP;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SNAP;
    const { on, unit } = parsed as Record<string, unknown>;
    if (typeof on !== 'boolean' || !(SNAP_UNITS as readonly unknown[]).includes(unit)) return DEFAULT_SNAP;
    return { on, unit: unit as SnapUnit };
  } catch {
    return DEFAULT_SNAP;
  }
}

export function writeSnapSetting(setting: SnapSetting) {
  localStorage.setItem(SNAP_STORAGE_KEY, JSON.stringify(setting));
}

// Magnet toggle + unit picker, laid out like the Transport's metronome split button:
// the icon toggles, the chevron opens a small picker. Picking a unit also turns snap on.
export function SnapControls({ value, onChange }: { value: SnapSetting; onChange: (next: SnapSetting) => void }) {
  return (
    <Popover>
      <div className="group flex items-center gap-0">
        <button
          type="button"
          aria-pressed={value.on}
          title={value.on ? 'Snap to grid: on (hold Shift while dragging to place freely)' : 'Snap to grid: off'}
          className={cn(
            'inline-flex items-center justify-center rounded-md p-1 text-muted-foreground ring-offset-background transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:text-foreground group-has-[.snap-chevron-trigger:hover]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0',
            value.on && 'text-primary hover:text-primary/80 group-has-[.snap-chevron-trigger:hover]:text-primary/80'
          )}
          onClick={() => onChange({ ...value, on: !value.on })}
        >
          <Magnet size={14} strokeWidth={2.5} />
        </button>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Snap grid"
            className={cn(
              // Hover-only background, never focus-visible — see the metronome chevron in
              // Transport.tsx (Radix refocuses the trigger on close).
              'snap-chevron-trigger -ml-0.5 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-muted-foreground transition-colors cursor-pointer hover:bg-white/5 hover:text-foreground focus-visible:outline-none',
              value.on && 'text-primary hover:text-primary/80'
            )}
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">{SNAP_LABELS[value.unit]}</span>
            <ChevronDown size={11} strokeWidth={3} />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="start" className="w-52 bg-[#0c0c0e] border-white/10 p-3">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">Snap</span>
        <div className="flex mt-2 rounded border border-border overflow-hidden">
          {SNAP_UNITS.map((unit, i) => (
            <button
              key={unit}
              type="button"
              onClick={() => onChange({ on: true, unit })}
              className={cn(
                'flex-1 py-1 text-[10px] flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors cursor-pointer',
                i < SNAP_UNITS.length - 1 && 'border-r border-border',
                value.unit === unit && 'bg-primary text-primary-foreground border-primary'
              )}
            >
              {SNAP_LABELS[unit]}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
