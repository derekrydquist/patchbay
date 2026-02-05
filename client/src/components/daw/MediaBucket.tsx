import React from 'react';
import { MOCK_CLIPS } from '@/lib/daw-data';
import { BucketClip } from './Clip';
import { Input } from '@/components/ui/input';
import { Search, FolderOpen, Music, Mic2, Guitar } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function MediaBucket() {
  return (
    <div className="w-80 h-full border-r border-border bg-sidebar flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-xl font-heading font-bold text-foreground mb-4 flex items-center gap-2">
          <FolderOpen size={20} className="text-primary" />
          Library
        </h2>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search loops..." className="pl-8 bg-black/20 border-border/50 focus:border-primary/50" />
        </div>
      </div>

      <Tabs defaultValue="all" className="flex-1 flex flex-col">
        <div className="px-4 mt-2">
          <TabsList className="w-full bg-black/20">
            <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
            <TabsTrigger value="drums" className="flex-1">Drums</TabsTrigger>
            <TabsTrigger value="inst" className="flex-1">Inst</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1 p-4">
          <TabsContent value="all" className="space-y-2 mt-0">
            {MOCK_CLIPS.map(clip => (
              <BucketClip key={clip.id} clip={clip} />
            ))}
          </TabsContent>
          <TabsContent value="drums" className="space-y-2 mt-0">
             {MOCK_CLIPS.filter(c => c.type === 'drums').map(clip => (
              <BucketClip key={clip.id} clip={clip} />
            ))}
          </TabsContent>
          <TabsContent value="inst" className="space-y-2 mt-0">
             {MOCK_CLIPS.filter(c => ['audio', 'midi'].includes(c.type)).map(clip => (
              <BucketClip key={clip.id} clip={clip} />
            ))}
          </TabsContent>
        </ScrollArea>
      </Tabs>
      
      <div className="p-4 border-t border-border bg-black/20">
         <div className="text-xs text-muted-foreground mb-2 font-bold uppercase tracking-wider">Storage</div>
         <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary w-[45%]" />
         </div>
         <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>4.2 GB used</span>
            <span>10 GB limit</span>
         </div>
      </div>
    </div>
  );
}
