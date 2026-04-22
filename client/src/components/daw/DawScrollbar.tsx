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
    const { scrollLeft, clientWidth } = timelineRef.current;
    const trackWidth = trackRef.current.clientWidth;
    
    const leftSec = scrollLeft / zoom;
    const widthSec = clientWidth / zoom;
    
    // The timeline track visually represents at least the project duration, 
    // or whatever is currently visible if we're zoomed far out.
    const maxSec = Math.max(projectDuration, leftSec + widthSec);
    
    return { leftSec, widthSec, maxSec, trackWidth, clientWidth };
  };

  const { leftSec, widthSec, maxSec, trackWidth, clientWidth } = getMetrics();

  const leftPercent = (leftSec / maxSec) * 100;
  const widthPercent = (widthSec / maxSec) * 100;

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
        let newZoom = startMetrics.clientWidth / newWidthSec;
        newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
        setZoom(newZoom);
      }
      else if (type === 'left') {
        const maxLeftSec = startMetrics.leftSec + startMetrics.widthSec - 1;
        const newLeftSec = Math.max(0, Math.min(maxLeftSec, startMetrics.leftSec + deltaSec));
        const newWidthSec = (startMetrics.leftSec + startMetrics.widthSec) - newLeftSec;
        
        let newZoom = startMetrics.clientWidth / newWidthSec;
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
    <div className="h-5 bg-[#09090b] border-t border-border/50 flex items-center px-2 sticky bottom-0 z-40 w-full shrink-0">
      <div 
        ref={trackRef}
        className="relative w-full h-2.5 bg-white/5 rounded-full overflow-hidden"
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
            className="w-4 h-full hover:bg-primary cursor-ew-resize flex items-center justify-center rounded-l-full"
            onPointerDown={(e) => handlePointerDown(e, 'left')}
          >
            <div className="w-[2px] h-[50%] bg-black/50" />
          </div>
          <div 
            className="w-4 h-full hover:bg-primary cursor-ew-resize flex items-center justify-center rounded-r-full"
            onPointerDown={(e) => handlePointerDown(e, 'right')}
          >
            <div className="w-[2px] h-[50%] bg-black/50" />
          </div>
        </div>
      </div>
    </div>
  );
}
