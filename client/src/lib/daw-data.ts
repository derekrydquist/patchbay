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
  isFinal?: boolean;
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
  sections: string[];
  instruments: InstrumentFolder[];
}

export type TaskStatus = 'todo' | 'in-progress' | 'review' | 'done';

export interface ProductionTask {
  id: string;
  title: string;
  instrument: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  assignee: string;
  dueDate?: string;
  description?: string;
  subtasks?: { id: string, text: string, completed: boolean }[];
  comments?: Comment[];
  relatedClipId?: string;
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
    metadata: createMetadata(ideaName, author, i + 1),
    isFinal: false
  }));
};

const instrumentConfigs: { name: string, type: 'instrument' | 'audio' | 'vocal', color: string, author: string, duration: number }[] = [
  { name: 'Drums', type: 'audio', color: 'hsl(var(--chart-1))', author: 'Dave', duration: 8 },
  { name: 'Bass', type: 'audio', color: 'hsl(var(--chart-2))', author: 'Sarah', duration: 16 },
  { name: 'Guitar 1', type: 'audio', color: 'hsl(var(--chart-3))', author: 'Mike', duration: 8 },
  { name: 'Guitar 2', type: 'audio', color: 'hsl(var(--chart-5))', author: 'Mike', duration: 8 },
  { name: 'Vocals', type: 'vocal', color: 'hsl(var(--chart-4))', author: 'Elena', duration: 16 }
];

export const DEFAULT_SECTIONS = ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'];

export const MOCK_SONG: Song = {
  id: 'song-1',
  name: 'Midnight Horizon',
  sections: [...DEFAULT_SECTIONS],
  instruments: instrumentConfigs.map(inst => ({
    id: nanoid(),
    name: inst.name,
    type: inst.type,
    ideas: DEFAULT_SECTIONS.map((ideaName, index) => {
      const isEmpty = (inst.name === 'Guitar 2' && index === 1) || 
                      (inst.name === 'Vocals' && index === 2) ||
                      (inst.name === 'Bass' && index === 0);
      
      return {
        id: nanoid(),
        name: `${inst.name} ${ideaName}`,
        versions: isEmpty ? [] : generateVersions(`${inst.name} ${ideaName}`, inst.author, inst.type === 'vocal' ? 'vocal' : 'audio', inst.color, inst.duration)
      };
    })
  }))
};

export const addInstrument = (name: string, color: string = 'hsl(var(--chart-1))') => {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!MOCK_SONG.instruments.some(inst => inst.name.toLowerCase() === trimmed.toLowerCase())) {
    MOCK_SONG.instruments = [
      ...MOCK_SONG.instruments,
      {
        id: nanoid(),
        name: trimmed,
        type: 'audio',
        ideas: MOCK_SONG.sections.map(sec => ({
          id: nanoid(),
          name: `${trimmed} ${sec}`,
          versions: []
        })),
      },
    ];
    window.dispatchEvent(new CustomEvent('song-updated'));
  }
};

export const addSection = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!MOCK_SONG.sections.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
    MOCK_SONG.sections.push(trimmed);
    MOCK_SONG.instruments.forEach(inst => {
      inst.ideas.push({
        id: nanoid(),
        name: `${inst.name} ${trimmed}`,
        versions: []
      });
    });
    window.dispatchEvent(new CustomEvent('song-updated'));
  }
};

export const MOCK_TASKS: ProductionTask[] = [
  { 
    id: '1', 
    title: 'Finalize chorus rhythm', 
    instrument: 'Drums', 
    status: 'done', 
    priority: 'high', 
    assignee: 'Dave',
    dueDate: '2024-02-15',
    description: 'The main driving beat for the second chorus.',
    subtasks: [
      { id: 's1', text: 'Quantize kick', completed: true },
      { id: 's2', text: 'Layer room mics', completed: true }
    ]
  },
  { 
    id: '2', 
    title: 'Add verse fills', 
    instrument: 'Drums', 
    status: 'in-progress', 
    priority: 'medium', 
    assignee: 'Dave',
    dueDate: '2024-02-18'
  },
  { id: '3', title: 'Record bridge bassline', instrument: 'Bass', status: 'todo', priority: 'high', assignee: 'Sarah' },
  { id: '4', title: 'Double track chorus guitars', instrument: 'Guitar 1', status: 'todo', priority: 'medium', assignee: 'Mike' },
  { id: '5', title: 'Main vocal comps', instrument: 'Vocals', status: 'review', priority: 'high', assignee: 'Elena' },
  { id: '6', title: 'Atmospheric textures', instrument: 'Guitar 2', status: 'todo', priority: 'low', assignee: 'Mike' },
];

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

export const INITIAL_TRACKS: Track[] = instrumentConfigs.map(inst => ({
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
