import { nanoid } from 'nanoid';

export type ClipType = 'audio' | 'midi' | 'drums' | 'vocal';

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: number;
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
  start: number;
  duration: number;
  src?: string;
  metadata?: ClipMetadata;
  comments?: Comment[];
}

export interface Idea {
  id: string;
  name: string;
  versions: Clip[];
}

export interface InstrumentFolder {
  id: string;
  name: string;
  type: 'instrument' | 'audio' | 'vocal';
  ideas: Idea[];
}

export interface Song {
  id: string;
  name: string;
  instruments: InstrumentFolder[];
}

const createMetadata = (name: string, author: string): ClipMetadata => ({
  format: 'WAV',
  sampleRate: '48kHz',
  bitDepth: '24-bit',
  description: 'Studio recording idea.',
  tags: ['idea', 'v1'],
  originalFileName: `${name.toLowerCase().replace(/\s+/g, '_')}.wav`,
  uploadedBy: author,
  uploadedDate: '2024-02-05',
  timeSignature: '4/4',
  key: 'A Minor',
  bpm: 120,
  channels: 'Stereo',
  peakLevel: '-3.0 dBFS'
});

export const MOCK_SONG: Song = {
  id: 'song-1',
  name: 'Midnight Horizon',
  instruments: [
    {
      id: 'inst-1',
      name: 'Drums',
      type: 'audio',
      ideas: [
        {
          id: 'idea-1',
          name: 'Main Beat',
          versions: [
            { id: 'v1-1', name: 'Main Beat V1', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 8, metadata: createMetadata('Main Beat V1', 'Dave') },
            { id: 'v1-2', name: 'Main Beat V2 (Heavy)', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 8, metadata: createMetadata('Main Beat V2', 'Dave') },
          ]
        },
        {
          id: 'idea-2',
          name: 'Fill Options',
          versions: [
            { id: 'v2-1', name: 'Snare Fill', type: 'drums', color: 'hsl(var(--chart-1))', start: 0, duration: 4, metadata: createMetadata('Snare Fill', 'Dave') },
          ]
        }
      ]
    },
    {
      id: 'inst-2',
      name: 'Bass',
      type: 'audio',
      ideas: [
        {
          id: 'idea-3',
          name: 'Verses',
          versions: [
            { id: 'v3-1', name: 'Verse A Rough', type: 'audio', color: 'hsl(var(--chart-2))', start: 0, duration: 16, metadata: createMetadata('Verse A', 'Sarah') },
          ]
        }
      ]
    }
  ]
};

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

export const INITIAL_TRACKS: Track[] = [
  { id: 't1', name: 'Drums', type: 'audio', volume: 80, pan: 0, muted: false, solo: false, color: 'hsl(var(--chart-1))', clips: [] },
  { id: 't2', name: 'Bass', type: 'audio', volume: 75, pan: -10, muted: false, solo: false, color: 'hsl(var(--chart-2))', clips: [] },
  { id: 't3', name: 'Vocals', type: 'vocal', volume: 90, pan: 0, muted: false, solo: false, color: 'hsl(var(--chart-4))', clips: [] }
];
