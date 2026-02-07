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

const createMetadata = (name: string, author: string, version: number): ClipMetadata => ({
  format: 'WAV',
  sampleRate: '48kHz',
  bitDepth: '24-bit',
  description: `Version ${version} of ${name}. Recorded in home studio.`,
  tags: ['idea', `v${version}`],
  originalFileName: `${name.toLowerCase().replace(/\s+/g, '_')}_v${version}.wav`,
  uploadedBy: author,
  uploadedDate: `2024-02-0${version + 1}`,
  timeSignature: '4/4',
  key: 'A Minor',
  bpm: 120,
  channels: 'Stereo',
  peakLevel: '-3.0 dBFS'
});

const generateVersions = (ideaName: string, author: string, type: ClipType, color: string, duration: number): Clip[] => {
  return Array.from({ length: 5 }).map((_, i) => ({
    id: nanoid(),
    name: `${ideaName} V${i + 1}`,
    type,
    color,
    start: 0,
    duration,
    metadata: createMetadata(ideaName, author, i + 1)
  }));
};

const instruments: { name: string, type: 'instrument' | 'audio' | 'vocal', color: string, author: string, duration: number }[] = [
  { name: 'Drums', type: 'audio', color: 'hsl(var(--chart-1))', author: 'Dave', duration: 8 },
  { name: 'Bass', type: 'audio', color: 'hsl(var(--chart-2))', author: 'Sarah', duration: 16 },
  { name: 'Guitar 1', type: 'audio', color: 'hsl(var(--chart-3))', author: 'Mike', duration: 8 },
  { name: 'Guitar 2', type: 'audio', color: 'hsl(var(--chart-5))', author: 'Mike', duration: 8 },
  { name: 'Vocals', type: 'vocal', color: 'hsl(var(--chart-4))', author: 'Elena', duration: 16 }
];

const ideasPerInstrument = ['Main Progression', 'Alternative Bridge', 'Outro Concept'];

export const MOCK_SONG: Song = {
  id: 'song-1',
  name: 'Midnight Horizon',
  instruments: instruments.map(inst => ({
    id: nanoid(),
    name: inst.name,
    type: inst.type,
    ideas: ideasPerInstrument.map(ideaName => ({
      id: nanoid(),
      name: `${inst.name} ${ideaName}`,
      versions: generateVersions(`${inst.name} ${ideaName}`, inst.author, inst.type === 'vocal' ? 'vocal' : 'audio', inst.color, inst.duration)
    }))
  }))
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

export const INITIAL_TRACKS: Track[] = instruments.map(inst => ({
  id: nanoid(),
  name: inst.name,
  type: inst.type,
  volume: 80,
  pan: 0,
  muted: false,
  solo: false,
  color: inst.color,
  clips: []
}));
