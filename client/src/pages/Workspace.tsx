import React, { useState } from 'react';
import { MediaBucket } from '@/components/daw/MediaBucket';
import { Timeline } from '@/components/daw/Timeline';
import { Transport } from '@/components/daw/Transport';
import { ProductionTracker } from '@/components/daw/ProductionTracker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Layout, CheckSquare, Settings, Share2, Music2, Bell, AtSign, Clock, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Workspace() {
  const [activeTab, setActiveTab] = useState('timeline');
  const [showNotifications, setShowNotifications] = useState(false);

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
          <Button variant="ghost" size="sm" className="text-[10px] uppercase tracking-widest hover:bg-white/5">
            <Share2 size={14} className="mr-2 text-primary" /> Share Session
          </Button>
          <div className="h-4 w-px bg-white/10 mx-1" />
          
          <Dialog open={showNotifications} onOpenChange={setShowNotifications}>
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
                <DropdownMenuItem className="text-xs focus:bg-white/5 focus:text-white cursor-pointer">
                  Manage Members
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

          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/20 to-white/10 border border-white/10 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
            <span className="text-[10px] font-bold text-primary">JD</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-h-0 relative">
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
