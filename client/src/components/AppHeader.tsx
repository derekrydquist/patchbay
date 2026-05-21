import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { Music2, Settings, SlidersHorizontal, Bell, Users, UserCircle, AtSign, Clock, MessageSquare, Copy, UserPlus, X, Shield, Link as LinkIcon, Globe, LogOut } from 'lucide-react';
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
  /** Called when the logo wordmark is clicked — omit to make it non-interactive */
  onLogoClick?: () => void;
  /** Rendered after the logo — e.g. a breadcrumb or tab bar */
  postLogoSlot?: React.ReactNode;
  /** Rendered before the gear icon — e.g. a primary action button */
  actionSlot?: React.ReactNode;
  className?: string;
}

const INITIAL_MEMBERS = [
  { id: 1, name: 'John Doe (You)', email: 'john@example.com', role: 'Owner', instrument: 'All Tracks', initials: 'JD', color: 'bg-primary/20 text-primary' },
  { id: 2, name: 'Sarah Smith',    email: 'sarah@example.com', role: 'Editor', instrument: 'Vocals',     initials: 'SS', color: 'bg-blue-500/20 text-blue-400' },
  { id: 3, name: 'Mike Johnson',   email: 'mike@example.com',  role: 'Viewer', instrument: 'Drums',      initials: 'MJ', color: 'bg-purple-500/20 text-purple-400' },
];

export function AppHeader({ preLogoSlot, onLogoClick, postLogoSlot, actionSlot, className }: AppHeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [members, setMembers] = useState(INITIAL_MEMBERS);
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
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
          {onLogoClick ? (
            <button
              onClick={onLogoClick}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            >
              {logoContent}
            </button>
          ) : (
            logoContent
          )}
          {postLogoSlot}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {actionSlot}

          {/* Workspace settings dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/5">
                <Settings size={18} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-[#0c0c0e] border-white/10">
              <DropdownMenuItem className="text-xs focus:bg-white/5 focus:text-white cursor-pointer">
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
    </>
  );
}
