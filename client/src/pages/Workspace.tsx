import React, { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { MediaBucket } from '@/components/daw/MediaBucket';
import { Timeline } from '@/components/daw/Timeline';
import { Transport } from '@/components/daw/Transport';
import { ProductionTracker } from '@/components/daw/ProductionTracker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Layout, CheckSquare, Music2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppHeader } from '@/components/AppHeader';

export default function Workspace() {
  const [location, setLocation] = useLocation();
  const { songId = 'patchbay-default' } = useParams<{ songId: string }>();
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') === 'production' ? 'tasks' : 'timeline';
  });
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

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', value === 'tasks' ? 'production' : 'arrangement');
    setLocation(`/songs/${songId}/workspace?${params.toString()}`);
  };


  return (
    <div className="h-screen flex flex-col bg-[#09090b] text-foreground overflow-hidden font-sans selection:bg-primary/30">
      <AppHeader
        onLogoClick={() => setLocation(`/songs/${songId}`)}
        postLogoSlot={
          <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full">
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
        }
      />

      <main className="flex-1 flex flex-col min-h-0 relative">
        <Tabs value={activeTab} className="h-full">
          <TabsContent value="timeline" className="m-0 h-full flex flex-col outline-none">
            <div className="flex-1 flex flex-col overflow-hidden">
               {/* Timeline now contains MediaBucket to ensure both share the same DndContext */}
               <Timeline songId={songId} />
            </div>
            <div className="p-4 bg-black/40 border-t border-white/5">
              <Transport songId={songId} />
            </div>
          </TabsContent>
          <TabsContent value="tasks" className="m-0 h-full outline-none">
            <ProductionTracker songId={songId} />
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
