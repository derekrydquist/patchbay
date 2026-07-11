import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Music2, Settings, SlidersHorizontal, Bell, Users, UserCircle, AtSign, Clock, MessageSquare, Copy, UserPlus, X, Plus, Shield, Link as LinkIcon, Globe, LogOut } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ProfileSettingsModal } from '@/components/ProfileSettingsModal';
import { cn, capitalize } from '@/lib/utils';

interface AppHeaderProps {
  /** Rendered before the logo — e.g. a back-navigation button */
  preLogoSlot?: React.ReactNode;
  /** Highlights one of the global nav links; omit on song-level surfaces */
  activeNav?: 'home' | 'library';
  /** Rendered after the logo and nav links — e.g. a breadcrumb or tab bar */
  postLogoSlot?: React.ReactNode;
  /** Rendered before the gear icon — e.g. a primary action button */
  actionSlot?: React.ReactNode;
  /** Rendered immediately before the gear/settings icon — e.g. mode tabs */
  preActionSlot?: React.ReactNode;
  className?: string;
}

const FACTORY_INSTRUMENTS = ['Drums', 'Bass', 'Guitar 1', 'Guitar 2', 'Vocals'];
const FACTORY_SECTIONS = ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'];
const FACTORY_BPM = 120;

const INITIAL_MEMBERS = [
  { id: 1, name: 'John Doe (You)', email: 'john@example.com', role: 'Owner', instrument: 'All Tracks', initials: 'JD', color: 'bg-primary/20 text-primary' },
  { id: 2, name: 'Sarah Smith',    email: 'sarah@example.com', role: 'Editor', instrument: 'Vocals',     initials: 'SS', color: 'bg-blue-500/20 text-blue-400' },
  { id: 3, name: 'Mike Johnson',   email: 'mike@example.com',  role: 'Viewer', instrument: 'Drums',      initials: 'MJ', color: 'bg-purple-500/20 text-purple-400' },
];

export function AppHeader({ preLogoSlot, activeNav, postLogoSlot, actionSlot, preActionSlot, className }: AppHeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [members, setMembers] = useState(INITIAL_MEMBERS);
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const queryClient = useQueryClient();
  const [draftInstruments, setDraftInstruments] = useState<string[]>([]);
  const [draftSections, setDraftSections] = useState<string[]>([]);
  const [draftBpm, setDraftBpm] = useState('120');
  const [addingInstrument, setAddingInstrument] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [newInstrumentDraft, setNewInstrumentDraft] = useState('');
  const [newSectionDraft, setNewSectionDraft] = useState('');

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(r => r.json()),
  });

  const saveSettings = useMutation({
    mutationFn: () => fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultInstruments: draftInstruments,
        defaultSections: draftSections,
        defaultBpm: parseInt(draftBpm, 10) || 120,
      }),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setShowProjectSettings(false);
    },
  });

  const openProjectSettings = () => {
    if (settings) {
      setDraftInstruments(settings.defaultInstruments);
      setDraftSections(settings.defaultSections);
      setDraftBpm(String(settings.defaultBpm));
    }
    setShowProjectSettings(true);
  };
  const userInitials = user
    ? capitalize(user.username).slice(0, 2).toUpperCase()
    : '??';

  const handleSignOut = async () => {
    await logout();
    setLocation('/login');
  };

  const logoContent = (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
        <Music2 size={18} className="text-black" />
      </div>
      <h1 className="text-lg font-heading font-black tracking-tighter uppercase text-white italic">
        Patch<span className="text-primary not-italic">Bay</span>
      </h1>
    </div>
  );

  return (
    <>
      <header className={cn('h-14 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between px-6 z-50', className)}>
        {/* Left side */}
        <div className="flex items-center gap-4">
          {preLogoSlot}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setLocation('/')}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer"
            >
              {logoContent}
            </button>
            {user?.bandName && (
              <span className="hidden md:block text-sm font-semibold text-white/90 whitespace-nowrap">
                {user.bandName}
              </span>
            )}
          </div>
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setLocation('/?tab=dashboard')}
              className={cn(
                'text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1.5 transition-colors cursor-pointer',
                activeNav === 'home' ? 'text-primary' : 'text-white/40 hover:text-white/70'
              )}
            >
              Home
            </button>
            <button
              onClick={() => setLocation('/?tab=files')}
              className={cn(
                'text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1.5 transition-colors cursor-pointer',
                activeNav === 'library' ? 'text-primary' : 'text-white/40 hover:text-white/70'
              )}
            >
              Library
            </button>
          </nav>
          {postLogoSlot}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {actionSlot}
          {preActionSlot}

          {/* Workspace settings dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/5">
                <Settings size={18} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-[#0c0c0e] border-white/10">
              <DropdownMenuItem
                className="text-xs focus:bg-white/5 focus:text-white cursor-pointer"
                onClick={openProjectSettings}
              >
                <SlidersHorizontal size={14} className="mr-2 text-primary/70" /> Project Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs focus:bg-white/5 focus:text-white cursor-pointer"
                onClick={() => setShowAccessModal(true)}
              >
                <Users size={14} className="mr-2 text-primary/70" /> Manage Access
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User avatar dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/20 to-white/10 border border-white/10 flex items-center justify-center hover:border-primary/50 transition-colors focus:outline-none">
                <span className="text-[10px] font-bold text-primary">{userInitials}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-[#0c0c0e] border-white/10">
              <DropdownMenuItem
                className="text-xs focus:bg-white/5 focus:text-white cursor-pointer"
                onClick={() => setShowNotifications(true)}
              >
                <Bell size={14} className="mr-2 text-primary/70" /> Notification Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs focus:bg-white/5 focus:text-white cursor-pointer"
                onClick={() => setShowProfileSettings(true)}
              >
                <UserCircle size={14} className="mr-2 text-primary/70" /> Profile Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem
                className="text-xs focus:bg-white/5 focus:text-red-400 cursor-pointer text-red-400/70"
                onClick={handleSignOut}
              >
                <LogOut size={14} className="mr-2" /> Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Notification Preferences modal */}
      <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-md p-0 overflow-hidden">
          <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
            <DialogHeader>
              <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white flex items-center gap-2">
                <Bell size={16} className="text-primary" /> Notification Preferences
              </DialogTitle>
            </DialogHeader>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-2">
              Manage how PatchBay alerts you about project updates
            </p>
          </div>
          <div className="p-6 space-y-6">
            <div className="space-y-4">
              <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold border-b border-white/5 pb-2">Email Notifications</h4>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-white/90 flex items-center gap-2">
                    <AtSign size={12} className="text-primary/60" /> @Mentions
                  </Label>
                  <p className="text-[10px] text-muted-foreground">When someone tags you in a comment</p>
                </div>
                <Switch defaultChecked className="data-[state=checked]:bg-primary" />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-white/90 flex items-center gap-2">
                    <MessageSquare size={12} className="text-primary/60" /> Task Comments
                  </Label>
                  <p className="text-[10px] text-muted-foreground">When someone comments on your assigned task</p>
                </div>
                <Switch defaultChecked className="data-[state=checked]:bg-primary" />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-white/90 flex items-center gap-2">
                    <Clock size={12} className="text-primary/60" /> Approaching Deadlines
                  </Label>
                  <p className="text-[10px] text-muted-foreground">48 hours before a task due date</p>
                </div>
                <Switch defaultChecked className="data-[state=checked]:bg-primary" />
              </div>
            </div>
            <div className="space-y-4 pt-4 border-t border-white/5">
              <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold border-b border-white/5 pb-2">In-App Alerts</h4>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-xs font-bold text-white/90">New File Uploads</Label>
                  <p className="text-[10px] text-muted-foreground">When a new version is added to the Bucket</p>
                </div>
                <Switch defaultChecked className="data-[state=checked]:bg-primary" />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Access modal */}
      <Dialog open={showAccessModal} onOpenChange={setShowAccessModal}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-2xl p-0 overflow-hidden">
          <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
            <DialogHeader>
              <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white flex items-center gap-2">
                <Users size={16} className="text-primary" /> Manage Access
              </DialogTitle>
            </DialogHeader>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-2">
              Share your session and manage collaborator permissions
            </p>
          </div>
          <div className="p-6 space-y-8">
            {/* Members list */}
            <div className="space-y-3">
              <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold flex items-center gap-2 mb-4">
                <Shield size={12} /> Current Members
              </h4>
              <div className="space-y-2 max-h-[240px] overflow-y-auto pr-2 scrollbar-hide">
                {members.map(member => (
                  <div key={member.id} className="flex items-center justify-between p-2 rounded-md hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
                    <div className="flex items-center gap-3">
                      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold border border-white/5 shadow-sm', member.color)}>
                        {member.initials}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white/90 flex items-center gap-2">
                          {member.name}
                          {member.role === 'Owner' && <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded uppercase tracking-wider">Owner</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{member.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="px-2 py-1 rounded bg-black/40 border border-white/5 text-[10px] uppercase tracking-widest text-white/60 w-[90px] text-center">
                        {member.instrument}
                      </div>
                      {member.role !== 'Owner' ? (
                        <>
                          <Select defaultValue={member.role.toLowerCase()}>
                            <SelectTrigger className="w-[100px] h-8 bg-black/40 border-white/10 text-xs shadow-none">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#0c0c0e] border-white/10">
                              <SelectItem value="editor" className="text-xs">Editor</SelectItem>
                              <SelectItem value="viewer" className="text-xs">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setMembers(prev => prev.filter(m => m.id !== member.id))}
                          >
                            <X size={14} />
                          </Button>
                        </>
                      ) : (
                        <div className="w-[140px] text-right text-xs text-muted-foreground italic pr-2">
                          Cannot modify owner
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Invite section */}
            <div className="space-y-3 pt-4 border-t border-white/5">
              <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold flex items-center gap-2">
                <UserPlus size={12} /> Invite Collaborators
              </h4>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Email address..."
                  className="flex-1 bg-black/40 border-white/10 text-xs focus-visible:ring-primary/50 h-9"
                />
                <Select defaultValue="instrument">
                  <SelectTrigger className="w-[140px] h-9 bg-black/40 border-white/10 text-xs">
                    <SelectValue placeholder="Assign Instrument" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0c0c0e] border-white/10 max-h-[200px]">
                    <SelectItem value="instrument" disabled className="text-xs font-bold text-primary/70">Assign Instrument</SelectItem>
                    <SelectItem value="all"    className="text-xs">All Tracks</SelectItem>
                    <SelectItem value="vocals" className="text-xs">Vocals</SelectItem>
                    <SelectItem value="guitar" className="text-xs">Guitar</SelectItem>
                    <SelectItem value="bass"   className="text-xs">Bass</SelectItem>
                    <SelectItem value="drums"  className="text-xs">Drums</SelectItem>
                    <SelectItem value="keys"   className="text-xs">Keys</SelectItem>
                  </SelectContent>
                </Select>
                <Select defaultValue="editor">
                  <SelectTrigger className="w-[110px] h-9 bg-black/40 border-white/10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0c0c0e] border-white/10">
                    <SelectItem value="editor" className="text-xs">Editor</SelectItem>
                    <SelectItem value="viewer" className="text-xs">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button className="h-9 px-4 bg-primary text-black hover:bg-primary/90 shrink-0 font-bold text-xs">
                  Invite
                </Button>
              </div>
            </div>

            {/* Share link section */}
            <div className="space-y-3 pt-4 border-t border-white/5">
              <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold flex items-center gap-2">
                <LinkIcon size={12} /> Share Link
              </h4>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    readOnly
                    value="https://patchbay.app/s/8f92a1b"
                    className="pl-9 bg-black/40 border-white/10 text-xs font-mono text-white/80 focus-visible:ring-primary/50 h-9"
                  />
                </div>
                <Select defaultValue="view">
                  <SelectTrigger className="w-[130px] h-9 bg-black/40 border-white/10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0c0c0e] border-white/10">
                    <SelectItem value="view" className="text-xs">Anyone can view</SelectItem>
                    <SelectItem value="edit" className="text-xs">Anyone can edit</SelectItem>
                    <SelectItem value="none" className="text-xs">No public access</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" className="h-9 px-4 border-white/10 hover:bg-white/5 hover:text-white shrink-0">
                  <Copy size={14} className="mr-2" /> Copy
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ProfileSettingsModal open={showProfileSettings} onOpenChange={setShowProfileSettings} />

      {/* Project Settings Modal */}
      <Dialog open={showProjectSettings} onOpenChange={open => { if (!open) setShowProjectSettings(false); }}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-md p-0 overflow-hidden">
          <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
            <DialogHeader>
              <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-primary" /> Project Settings
              </DialogTitle>
            </DialogHeader>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-2">
              Defaults applied when creating a new song
            </p>
          </div>
          <div className="p-6 space-y-6">

            {/* Default BPM */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold">Default BPM</Label>
              <Input
                type="number"
                min={40}
                max={999}
                value={draftBpm}
                onChange={e => setDraftBpm(e.target.value)}
                className="bg-black/40 border-white/10 text-sm focus-visible:ring-primary/50 w-32"
              />
            </div>

            {/* Default Instruments */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold border-b border-white/5 pb-2 block">Default Instruments</Label>
              <div className="min-h-[44px] rounded-md border border-white/10 bg-black/40 px-2 py-1.5 flex flex-wrap gap-1.5 items-center">
                {draftInstruments.map((item, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-white/8 border border-white/10 rounded px-2 py-0.5 text-xs font-medium text-white/80">
                    {item}
                    <button type="button" onClick={() => setDraftInstruments(prev => prev.filter((_, idx) => idx !== i))} className="text-white/40 hover:text-white transition-colors">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {addingInstrument ? (
                  <input
                    autoFocus
                    value={newInstrumentDraft}
                    onChange={e => setNewInstrumentDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const v = newInstrumentDraft.trim();
                        if (v && !draftInstruments.includes(v)) setDraftInstruments(prev => [...prev, v]);
                        setNewInstrumentDraft(''); setAddingInstrument(false);
                      }
                      if (e.key === 'Escape') { setNewInstrumentDraft(''); setAddingInstrument(false); }
                    }}
                    onBlur={() => {
                      const v = newInstrumentDraft.trim();
                      if (v && !draftInstruments.includes(v)) setDraftInstruments(prev => [...prev, v]);
                      setNewInstrumentDraft(''); setAddingInstrument(false);
                    }}
                    className="inline-flex bg-white/8 border border-primary/50 rounded px-2 py-0.5 text-xs text-white outline-none min-w-[80px] w-24"
                  />
                ) : (
                  <button type="button" onClick={() => setAddingInstrument(true)} className="inline-flex items-center gap-1 border border-dashed border-white/20 rounded px-2 py-0.5 text-xs font-medium text-white/35 hover:text-white/70 hover:border-white/35 transition-colors">
                    <Plus size={10} /> Add
                  </button>
                )}
              </div>
            </div>

            {/* Default Sections */}
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold border-b border-white/5 pb-2 block">Default Sections</Label>
              <div className="min-h-[44px] rounded-md border border-white/10 bg-black/40 px-2 py-1.5 flex flex-wrap gap-1.5 items-center">
                {draftSections.map((item, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-white/8 border border-white/10 rounded px-2 py-0.5 text-xs font-medium text-white/80">
                    {item}
                    <button type="button" onClick={() => setDraftSections(prev => prev.filter((_, idx) => idx !== i))} className="text-white/40 hover:text-white transition-colors">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {addingSection ? (
                  <input
                    autoFocus
                    value={newSectionDraft}
                    onChange={e => setNewSectionDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const v = newSectionDraft.trim();
                        if (v && !draftSections.includes(v)) setDraftSections(prev => [...prev, v]);
                        setNewSectionDraft(''); setAddingSection(false);
                      }
                      if (e.key === 'Escape') { setNewSectionDraft(''); setAddingSection(false); }
                    }}
                    onBlur={() => {
                      const v = newSectionDraft.trim();
                      if (v && !draftSections.includes(v)) setDraftSections(prev => [...prev, v]);
                      setNewSectionDraft(''); setAddingSection(false);
                    }}
                    className="inline-flex bg-white/8 border border-primary/50 rounded px-2 py-0.5 text-xs text-white outline-none min-w-[80px] w-24"
                  />
                ) : (
                  <button type="button" onClick={() => setAddingSection(true)} className="inline-flex items-center gap-1 border border-dashed border-white/20 rounded px-2 py-0.5 text-xs font-medium text-white/35 hover:text-white/70 hover:border-white/35 transition-colors">
                    <Plus size={10} /> Add
                  </button>
                )}
              </div>
            </div>

          </div>
          <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
            <Button
              variant="outline"
              className="border-white/10 hover:bg-white/5 text-xs text-white/50 hover:text-white"
              onClick={() => {
                setDraftInstruments(FACTORY_INSTRUMENTS);
                setDraftSections(FACTORY_SECTIONS);
                setDraftBpm(String(FACTORY_BPM));
              }}
            >
              Restore Defaults
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" className="border-white/10 hover:bg-white/5 text-xs" onClick={() => setShowProjectSettings(false)}>
                Cancel
              </Button>
              <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending} className="bg-primary text-black hover:bg-primary/90 font-bold text-xs">
                {saveSettings.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
