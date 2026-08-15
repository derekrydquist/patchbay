import React from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, MessageCircle } from 'lucide-react';

interface CornerBadgeProps {
  variant: 'final' | 'comment';
  corner: 'top-right' | 'bottom-right';
  hasUnread?: boolean;
  onClick?: () => void;
}

export function CornerBadge({ variant, corner, hasUnread, onClick }: CornerBadgeProps) {
  const cornerClass = corner === 'top-right'
    ? 'absolute top-0 right-0 p-0.5'
    : 'absolute bottom-0 right-0 p-0.5';

  if (variant === 'final') {
    return (
      <div className={cn(cornerClass, 'bg-primary rounded-bl shadow-sm z-10')}>
        <CheckCircle2 size={10} className="text-black" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        cornerClass,
        'rounded-tl shadow-sm z-[21] cursor-pointer',
        hasUnread ? 'bg-primary' : 'bg-white/[0.25]'
      )}
      onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      <MessageCircle size={10} className={hasUnread ? 'text-black' : 'text-white/60'} />
    </div>
  );
}
