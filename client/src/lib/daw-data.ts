import { nanoid } from 'nanoid';

export type ClipType = 'audio' | 'midi' | 'drums' | 'vocal';

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: number; // grid position
  createdAt: string;
}

export interface ClipMetadata {
  format: string;
  sampleRate: string;
  bitDepth: string;
  description: string;
  tags: string[];
  originalFileName: string;
  uploadedBy: string;
  uploadedDate: string;
  timeSignature: string;
  key: string;
  bpm: number;
  channels: 'Mono' | 'Stereo' | '5.1';
  peakLevel: string;
}

export interface Clip {
  id: string;
  name: string;
  type: ClipType;
  color: string;
  start: number; // grid position (0-100)
  duration: number; // grid units
  src?: string; // mock source
  metadata?: ClipMetadata;
  comments?: Comment[];
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

const createMetadata = (name: string): ClipMetadata => ({
  format: 'WAV',
  sampleRate: '48kHz',
  bitDepth: '24-bit',
  description: 'High-quality studio recording processed through analog hardware.',
  tags: ['studio', 'raw', 'v1', 'dry'],
  originalFileName: `${name.toLowerCase().replace(/\s+/g, '_')}_final_v2.wav`,
  uploadedBy: 'Alex Rivers',
  uploadedDate: '2024-02-05 14:32',
  timeSignature: '4/4',
  key: 'A Minor',
  bpm: 120,
  channels: 'Stereo',
  peakLevel: '-3.2 dBFS'
});

export const MOCK_CLIPS: Clip[] = [
  { 
    id: 'c1', 
    name: 'Kick Basic', 
    type: 'drums', 
    color: 'hsl(var(--chart-1))', 
    start: 0, 
    duration: 4,
    metadata: { 
      ...createMetadata('Kick Basic'), 
      key: 'N/A', 
      channels: 'Mono',
      description: 'Solid foundational kick drum with a tight sub-end.'
    },
    comments: [
      { id: 'com1', author: 'Producer', text: 'This punch feels great', timestamp: 1, createdAt: '2024-02-05' }
    ]
  },
  { id: 'c2', name: 'Snare Snap', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 4, metadata: { ...createMetadata('Snare Snap'), channels: 'Mono', key: 'N/A' } },
  { id: 'c3', name: 'Hi-Hat 8ths', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 8, metadata: { ...createMetadata('Hi-Hat 8ths'), channels: 'Mono', key: 'N/A' } },
  { id: 'c4', name: 'Bass Groove A', type: 'audio', color: 'hsl(var(--chart-2))', start: 0, duration: 16, metadata: createMetadata('Bass Groove A') },
  { id: 'c5', name: 'Guitar Riff', type: 'audio', color: 'hsl(var(--chart-3))', start: 0, duration: 8, metadata: { ...createMetadata('Guitar Riff'), key: 'E Minor' } },
  { id: 'c6', name: 'Synth Pad', type: 'midi', color: 'hsl(var(--chart-5))', start: 0, duration: 12, metadata: createMetadata('Synth Pad') },
  { id: 'c7', name: 'Vocal Hook', type: 'vocal', color: 'hsl(var(--chart-4))', start: 0, duration: 8, metadata: { ...createMetadata('Vocal Hook'), description: 'Lead vocal take with light compression.' } },
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
      { 
        id: 'tc1', 
        name: 'Kick Basic', 
        type: 'drums', 
        color: 'hsl(var(--chart-1))', 
        start: 0, 
        duration: 8,
        metadata: createMetadata('Kick Basic'),
        comments: []
      },
      { id: 'tc2', name: 'Snare Snap', type: 'drums', color: 'hsl(var(--chart-1))', start: 16, duration: 8, metadata: createMetadata('Snare Snap') },
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
      { id: 'tc3', name: 'Bass Groove A', type: 'audio', color: 'hsl(var(--chart-2))', start: 0, duration: 32, metadata: createMetadata('Bass Groove A') },
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
