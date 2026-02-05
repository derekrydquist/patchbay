import { nanoid } from 'nanoid';

export type ClipType = 'audio' | 'midi' | 'drums' | 'vocal';

export interface Clip {
  id: string;
  name: string;
  type: ClipType;
  color: string;
  start: number; // grid position (0-100)
  duration: number; // grid units
  src?: string; // mock source
}

export interface Track {
  id: string;
  name: string;
  type: 'instrument' | 'audio' | 'master' | 'vocal';
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  color: string;
  clips: Clip[];
}

export const MOCK_CLIPS: Clip[] = [
  { id: 'c1', name: 'Kick Basic', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 4 },
  { id: 'c2', name: 'Snare Snap', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 4 },
  { id: 'c3', name: 'Hi-Hat 8ths', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 8 },
  { id: 'c4', name: 'Bass Groove A', type: 'audio', color: 'hsl(var(--chart-2))', start: 0, duration: 16 },
  { id: 'c5', name: 'Guitar Riff', type: 'audio', color: 'hsl(var(--chart-3))', start: 0, duration: 8 },
  { id: 'c6', name: 'Synth Pad', type: 'midi', color: 'hsl(var(--chart-5))', start: 0, duration: 12 },
  { id: 'c7', name: 'Vocal Hook', type: 'vocal', color: 'hsl(var(--chart-4))', start: 0, duration: 8 },
];

export const INITIAL_TRACKS: Track[] = [
  {
    id: 't1',
    name: 'Drums',
    type: 'audio',
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
    color: 'hsl(var(--chart-1))',
    clips: [
      { id: 'tc1', name: 'Kick Basic', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 8 },
      { id: 'tc2', name: 'Snare Snap', type: 'drums', color: 'hsl(var(--chart-1))', start: 16, duration: 8 },
    ]
  },
  {
    id: 't2',
    name: 'Bass',
    type: 'audio',
    volume: 75,
    pan: -10,
    muted: false,
    solo: false,
    color: 'hsl(var(--chart-2))',
    clips: [
      { id: 'tc3', name: 'Bass Groove A', type: 'audio', color: 'hsl(var(--chart-2))', start: 0, duration: 32 },
    ]
  },
  {
    id: 't3',
    name: 'Guitars',
    type: 'audio',
    volume: 60,
    pan: 20,
    muted: false,
    solo: false,
    color: 'hsl(var(--chart-3))',
    clips: []
  },
  {
    id: 't4',
    name: 'Vocals',
    type: 'vocal',
    volume: 90,
    pan: 0,
    muted: false,
    solo: false,
    color: 'hsl(var(--chart-4))',
    clips: []
  }
];
