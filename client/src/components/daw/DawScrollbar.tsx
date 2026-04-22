import React, { useEffect, useRef, useState, useCallback } from 'react';

interface DawScrollbarProps {
  timelineRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  setZoom: (zoom: number) => void;
  projectDuration: number;
}

const MIN_ZOOM = 10; // px per sec
const MAX_ZOOM = 300; // px per sec

export function DawScrollbar({ timelineRef, zoom, setZoom, projectDuration }: DawScrollbarProps) {
  const [, setForceRender] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  
  const updateThumb = useCallback(() => {
    setForceRender(v => v + 1);
  }, []);

  useEffect(() => {
    const el = timelineRef.current;
    if (el) {
      el.addEventListener('scroll', updateThumb);
      window.addEventListener('resize', updateThumb);
      updateThumb();
      return () => {
        el.removeEventListener('scroll', updateThumb);
        window.removeEventListener('resize', updateThumb);
      };
    }
  }, [timelineRef, updateThumb]);

  const getMetrics = () => {
    if (!timelineRef.current || !trackRef.current) {
      return { leftSec: 0, widthSec: 10, maxSec: 120, trackWidth: 1000, clientWidth: 1000 };
    }
    const { scrollLeft, clientWidth, scrollWidth } = timelineRef.current;
    const trackWidth = trackRef.current.clientWidth;
    
    const leftSec = scrollLeft / zoom;
    const widthSec = Math.max(1, clientWidth - 256) / zoom;
    
    const totalTimelineWidth = scrollWidth - 256;
    const maxSec = Math.max(projectDuration, totalTimelineWidth / zoom);
    
    return { leftSec, widthSec, maxSec, trackWidth, clientWidth };
  };

  const { leftSec, widthSec, maxSec, trackWidth, clientWidth } = getMetrics();

  const leftPercent = Math.max(0, Math.min(100, (leftSec / maxSec) * 100));
  const widthPercent = Math.max(2, Math.min(100, (widthSec / maxSec) * 100));

  const handlePointerDown = (e: React.PointerEvent, type: 'pan' | 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startMetrics = getMetrics();
    const startZoom = zoom;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaSec = (deltaX / startMetrics.trackWidth) * startMetrics.maxSec;

      if (type === 'pan') {
        const newLeftSec = Math.max(0, startMetrics.leftSec + deltaSec);
        if (timelineRef.current) {
          timelineRef.current.scrollLeft = newLeftSec * startZoom;
        }
      } 
      else if (type === 'right') {
        const newRightSec = Math.max(startMetrics.leftSec + 1, startMetrics.leftSec + startMetrics.widthSec + deltaSec);
        const newWidthSec = newRightSec - startMetrics.leftSec;
        const targetClientWidth = startMetrics.clientWidth - 256;
        let newZoom = targetClientWidth / newWidthSec;
        newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
        setZoom(newZoom);
      }
      else if (type === 'left') {
        const maxLeftSec = startMetrics.leftSec + startMetrics.widthSec - 1;
        const newLeftSec = Math.max(0, Math.min(maxLeftSec, startMetrics.leftSec + deltaSec));
        const newWidthSec = (startMetrics.leftSec + startMetrics.widthSec) - newLeftSec;
        
        const targetClientWidth = startMetrics.clientWidth - 256;
        let newZoom = targetClientWidth / newWidthSec;
        newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
        setZoom(newZoom);
        
        if (timelineRef.current) {
          timelineRef.current.scrollLeft = newLeftSec * newZoom;
        }
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div className="h-16 bg-[#09090b] border-t border-border/20 flex items-center pr-6 sticky bottom-0 z-40 w-full shrink-0 shadow-[0_-5px_20px_rgba(0,0,0,0.3)]">
      <div className="w-64 shrink-0 border-r border-border/10 h-full bg-card/20 flex items-center px-4">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Zoom / Pan</span>
      </div>
      <div className="flex-1 pl-6">
        <div 
          ref={trackRef}
          className="relative w-full h-8 bg-black/60 rounded-full overflow-hidden border border-white/5"
        >
          <div 
            className="absolute top-0 bottom-0 bg-primary/30 hover:bg-primary/40 border border-primary/40 rounded-full flex items-center justify-between group cursor-grab active:cursor-grabbing transition-colors"
            style={{
              left: `${leftPercent}%`,
              width: `${widthPercent}%`
            }}
            onPointerDown={(e) => handlePointerDown(e, 'pan')}
          >
            <div 
              className="w-10 h-full hover:bg-white/20 cursor-ew-resize flex items-center justify-center rounded-l-full transition-colors"
              onPointerDown={(e) => handlePointerDown(e, 'left')}
            >
              <div className="flex gap-1">
                <div className="w-[1.5px] h-4 bg-white/50 rounded-full" />
                <div className="w-[1.5px] h-4 bg-white/50 rounded-full" />
              </div>
            </div>
            <div 
              className="w-10 h-full hover:bg-white/20 cursor-ew-resize flex items-center justify-center rounded-r-full transition-colors"
              onPointerDown={(e) => handlePointerDown(e, 'right')}
            >
              <div className="flex gap-1">
                <div className="w-[1.5px] h-4 bg-white/50 rounded-full" />
                <div className="w-[1.5px] h-4 bg-white/50 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
