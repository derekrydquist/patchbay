import { nanoid } from 'nanoid';

export type ClipType = 'audio' | 'midi' | 'drums' | 'vocal' | 'custom-audio';

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
  sectionName?: string;
  trimStart?: number;
  trimEnd?: number | null;
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
  color?: string;
  ideas: Idea[];
}

export interface Song {
  id: string;
  name: string;
  bpm?: number;
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
  tags: ['idea', `V${version}`],
  originalFileName: `${name} V${version}.wav`,
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
    color: inst.color,
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
        color,
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

export const addVersionToIdea = (ideaId: string, file: File, fileName: string) => {
  for (const inst of MOCK_SONG.instruments) {
    const idea = inst.ideas.find(i => i.id === ideaId);
    if (idea) {
      const versionNum = idea.versions.length + 1;
      const newClip: Clip = {
        id: nanoid(),
        name: `${idea.name} V${versionNum}`,
        type: inst.type === 'vocal' ? 'vocal' : 'audio',
        color: inst.color || 'hsl(var(--primary))',
        start: 0,
        duration: 16, // Default duration, in a real app we'd parse the audio file
        src: URL.createObjectURL(file), // Local object URL for playback simulation
        metadata: {
          format: fileName.split('.').pop()?.toUpperCase() || 'WAV',
          sampleRate: '48kHz',
          bitDepth: '24-bit',
          description: `Uploaded file: ${fileName}`,
          tags: ['upload', 'raw'],
          originalFileName: fileName,
          uploadedBy: 'You',
          uploadedDate: new Date().toISOString().split('T')[0],
          timeSignature: '4/4',
          key: 'Unknown',
          bpm: MOCK_SONG.bpm || 120,
          channels: 'Stereo',
          peakLevel: '-1.0 dBFS'
        },
        isFinal: false
      };
      idea.versions.push(newClip);
      window.dispatchEvent(new CustomEvent('song-updated'));
      break;
    }
  }
};

export const MOCK_TASKS: ProductionTask[] = [];

// Generate tasks based on the production grid (1:1 with instrument and song section)
MOCK_SONG.instruments.forEach(inst => {
  MOCK_SONG.sections.forEach((section, index) => {
    // Let's create a mix of statuses to make it look realistic
    let status: TaskStatus = 'todo';
    if (index === 0) status = 'done'; // Intro is usually done first
    else if (index === 1 && inst.name === 'Drums') status = 'in-progress';
    else if (index === 2 && inst.name === 'Vocals') status = 'review';
    
    // Skip creating tasks for "empty" ideas that we defined earlier
    const isEmpty = (inst.name === 'Guitar 2' && index === 1) || 
                    (inst.name === 'Vocals' && index === 2) ||
                    (inst.name === 'Bass' && index === 0);
                    
    if (!isEmpty) {
      MOCK_TASKS.push({
        id: nanoid(),
        title: `${section} - ${inst.name}`,
        instrument: inst.name,
        status,
        priority: status === 'todo' ? 'medium' : 'high',
        assignee: inst.name === 'Drums' ? 'Dave' : (inst.name === 'Vocals' ? 'Elena' : (inst.name === 'Bass' ? 'JD (You)' : 'Mike'))
      });
    }
  });
});

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

const STABLE_TRACK_IDS = ['track-drums', 'track-bass', 'track-guitar-1', 'track-guitar-2', 'track-vocals'];

export const INITIAL_TRACKS: Track[] = instrumentConfigs.map((inst, i) => ({
  id: STABLE_TRACK_IDS[i],
  name: inst.name,
  type: inst.type,
  volume: 80,
  pan: 0,
  muted: false,
  solo: false,
  color: inst.color,
  clips: []
}));
