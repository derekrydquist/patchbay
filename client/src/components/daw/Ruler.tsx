import React from 'react';

export function Ruler({ onSeek }: { onSeek?: (pos: number) => void }) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (onSeek) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = e.clientX - rect.left;
      onSeek(pos);
    }
  };

  return (
    <div className="h-8 border-b border-border bg-card/50 flex items-end sticky top-0 z-30 select-none">
       {/* Top-left placeholder for Track Headers */}
       <div className="w-64 shrink-0 bg-card border-r border-border h-full sticky left-0 z-40" />
       
       <div 
         className="flex-1 relative h-full cursor-text"
         onClick={handleClick}
       >
         {Array.from({ length: 100 }).map((_, i) => (
           <div key={i} className="absolute bottom-0 h-4 border-l border-muted-foreground/30 text-[9px] text-muted-foreground pl-1 font-mono pointer-events-none" style={{ left: i * 80 }}>
             {i}.0
             <div className="absolute top-0 left-0 h-full w-[80px] flex justify-between px-[20px] opacity-20">
                <div className="h-2 w-[1px] bg-muted-foreground self-end" />
                <div className="h-2 w-[1px] bg-muted-foreground self-end" />
                <div className="h-2 w-[1px] bg-muted-foreground self-end" />
             </div>
           </div>
         ))}
       </div>
    </div>
  );
}
