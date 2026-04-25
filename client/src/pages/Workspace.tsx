import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { MediaBucket } from '@/components/daw/MediaBucket';
import { Timeline } from '@/components/daw/Timeline';
import { Transport } from '@/components/daw/Transport';
import { ProductionTracker } from '@/components/daw/ProductionTracker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Layout, CheckSquare, Settings, Share2, Music2, Bell, AtSign, Clock, MessageSquare, Users, Copy, UserPlus, X, Shield, Link as LinkIcon, Globe, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Workspace() {
  const [location, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState('timeline');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [workingContext, setWorkingContext] = useState<{ instrument: string | null, section: string | null }>({ instrument: null, section: null });

  useEffect(() => {
    // Parse URL params for context
    const searchParams = new URLSearchParams(window.location.search);
    const instrument = searchParams.get('instrument');
    const section = searchParams.get('section');
    
    if (instrument || section) {
      setWorkingContext({ instrument, section });
    }
  }, [location]);

  const [members, setMembers] = useState([
    { id: 1, name: 'John Doe (You)', email: 'john@example.com', role: 'Owner', instrument: 'All Tracks', initials: 'JD', color: 'bg-primary/20 text-primary' },
    { id: 2, name: 'Sarah Smith', email: 'sarah@example.com', role: 'Editor', instrument: 'Vocals', initials: 'SS', color: 'bg-blue-500/20 text-blue-400' },
    { id: 3, name: 'Mike Johnson', email: 'mike@example.com', role: 'Viewer', instrument: 'Drums', initials: 'MJ', color: 'bg-purple-500/20 text-purple-400' },
  ]);

  return (
    <div className="h-screen flex flex-col bg-[#09090b] text-foreground overflow-hidden font-sans selection:bg-primary/30">
      {/* Premium Header */}
      <header className="h-14 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
              <Music2 size={18} className="text-black" />
            </div>
            <h1 className="text-lg font-heading font-black tracking-tighter uppercase text-white italic">
              Studio <span className="text-primary not-italic">Lux</span>
            </h1>
          </div>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
            <TabsList className="bg-transparent border-none p-0 h-14 gap-1">
              <TabsTrigger 
                value="timeline" 
                className="data-[state=active]:bg-white/5 data-[state=active]:text-primary rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 h-14 text-[10px] uppercase tracking-[0.2em] font-bold transition-all"
              >
                <Layout size={14} className="mr-2" /> Arrangement
              </TabsTrigger>
              <TabsTrigger 
                value="tasks" 
                className="data-[state=active]:bg-white/5 data-[state=active]:text-primary rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 h-14 text-[10px] uppercase tracking-[0.2em] font-bold transition-all"
              >
                <CheckSquare size={14} className="mr-2" /> Production
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/5">
                <Settings size={18} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-[#0c0c0e] border-white/10">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Workspace</DropdownMenuLabel>
              <DropdownMenuItem className="text-xs focus:bg-white/5 focus:text-white cursor-pointer">
                Project Settings
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="text-xs focus:bg-white/5 focus:text-white cursor-pointer"
                onClick={() => setShowAccessModal(true)}
              >
                <Users size={14} className="mr-2 text-primary/70" /> Manage Access
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">User</DropdownMenuLabel>
              <DropdownMenuItem 
                className="text-xs focus:bg-white/5 focus:text-white cursor-pointer"
                onClick={() => setShowNotifications(true)}
              >
                <Bell size={14} className="mr-2 text-primary/70" /> Notification Settings
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs focus:bg-white/5 focus:text-white cursor-pointer">
                Profile Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
            <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-md p-0 overflow-hidden">
              <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
                <DialogHeader>
                  <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white flex items-center gap-2">
                    <Bell size={16} className="text-primary" /> Notification Preferences
                  </DialogTitle>
                </DialogHeader>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-2">
                  Manage how Studio Lux alerts you about project updates
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
                {/* Members List */}
                <div className="space-y-3">
                  <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold flex items-center gap-2 mb-4">
                    <Shield size={12} /> Current Members
                  </h4>
                  <div className="space-y-2 max-h-[240px] overflow-y-auto pr-2 scrollbar-hide">
                    {members.map(member => (
                      <div key={member.id} className="flex items-center justify-between p-2 rounded-md hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold border border-white/5 shadow-sm", member.color)}>
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
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setMembers(members.filter(m => m.id !== member.id))}>
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

                {/* Invite Section */}
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
                        <SelectItem value="all" className="text-xs">All Tracks</SelectItem>
                        <SelectItem value="vocals" className="text-xs">Vocals</SelectItem>
                        <SelectItem value="guitar" className="text-xs">Guitar</SelectItem>
                        <SelectItem value="bass" className="text-xs">Bass</SelectItem>
                        <SelectItem value="drums" className="text-xs">Drums</SelectItem>
                        <SelectItem value="keys" className="text-xs">Keys</SelectItem>
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

                {/* Share Link Section */}
                <div className="space-y-3 pt-4 border-t border-white/5">
                  <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold flex items-center gap-2">
                    <LinkIcon size={12} /> Share Link
                  </h4>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input 
                        readOnly 
                        value="https://studiolux.app/s/8f92a1b" 
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

          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/20 to-white/10 border border-white/10 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
            <span className="text-[10px] font-bold text-primary">JD</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-h-0 relative">
        {/* Context Banner */}
        {workingContext.section && workingContext.instrument && (
          <div className="absolute top-0 left-0 right-0 h-8 bg-primary text-black z-40 flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 animate-in slide-in-from-top">
            <Info size={14} />
            Working on: {workingContext.section} <span className="mx-2 opacity-50">—</span> {workingContext.instrument}
            <button 
              onClick={() => setWorkingContext({ instrument: null, section: null })}
              className="absolute right-4 p-1 hover:bg-black/10 rounded-full transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <Tabs value={activeTab} className="h-full">
          <TabsContent value="timeline" className="m-0 h-full flex flex-col outline-none">
            <div className="flex-1 flex flex-col overflow-hidden">
               {/* Timeline now contains MediaBucket to ensure both share the same DndContext */}
               <Timeline />
            </div>
            <div className="p-4 bg-black/40 border-t border-white/5">
              <Transport />
            </div>
          </TabsContent>
          <TabsContent value="tasks" className="m-0 h-full outline-none">
            <ProductionTracker />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// Internal Button component since it's used in Workspace
function Button({ className, variant, size, ...props }: any) {
  const variants: any = {
    ghost: "bg-transparent hover:bg-accent hover:text-accent-foreground",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
  };
  const sizes: any = {
    sm: "h-9 px-3 rounded-md",
    icon: "h-10 w-10",
  };
  return (
    <button 
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variants[variant || 'outline'],
        sizes[size || 'sm'],
        className
      )} 
      {...props} 
    />
  );
}
