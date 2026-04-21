import React from 'react';

export function Ruler() {
  return (
    <div className="h-8 border-b border-border bg-card/50 ml-[240px] flex items-end pb-1 relative overflow-hidden select-none">
       {/* Just a visual ruler */}
       {Array.from({ length: 100 }).map((_, i) => (
         <div key={i} className="absolute bottom-0 h-4 border-l border-muted-foreground/30 text-[9px] text-muted-foreground pl-1 font-mono" style={{ left: i * 80 }}>
           {i + 1}.0
           <div className="absolute top-0 left-0 h-full w-[80px] flex justify-between px-[20px] pointer-events-none opacity-20">
              <div className="h-2 w-[1px] bg-muted-foreground self-end" />
              <div className="h-2 w-[1px] bg-muted-foreground self-end" />
              <div className="h-2 w-[1px] bg-muted-foreground self-end" />
           </div>
         </div>
       ))}
    </div>
  );
}
