import React, { useState } from 'react';
import { MediaBucket } from '@/components/daw/MediaBucket';
import { Timeline } from '@/components/daw/Timeline';
import { Transport } from '@/components/daw/Transport';
import { ProductionTracker } from '@/components/daw/ProductionTracker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Layout, CheckSquare, Settings, Share2, Music2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Workspace() {
  const [activeTab, setActiveTab] = useState('timeline');

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
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-white/5">
            <Settings size={18} className="text-muted-foreground" />
          </Button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/20 to-white/10 border border-white/10 flex items-center justify-center">
            <span className="text-[10px] font-bold text-primary">JD</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-h-0 relative">
        <Tabs value={activeTab} className="h-full">
          <TabsContent value="timeline" className="m-0 h-full flex flex-col outline-none">
            <MediaBucket />
            <Timeline />
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
