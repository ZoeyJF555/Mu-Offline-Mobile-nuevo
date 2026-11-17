import React, { useRef, useState } from 'react';

interface PubgJoystickProps {
  scale: number;
  disabled?: boolean;
  onVectorChange: (x: number, y: number) => void;
}

export const PubgJoystick: React.FC<PubgJoystickProps> = ({
  scale,
  disabled,
  onVectorChange,
}) => {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });
  const activePointer = useRef<number | null>(null);

  const radius = 48 * scale;
  const maxTravel = 34 * scale;

  const updateFromClient = (clientX: number, clientY: number) => {
    const el = baseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxTravel) {
      dx = (dx / dist) * maxTravel;
      dy = (dy / dist) * maxTravel;
    }
    setKnobOffset({ x: dx, y: dy });
    onVectorChange(dx / maxTravel, dy / maxTravel);
  };

  return (
    <div
      ref={baseRef}
      style={{ width: radius * 2, height: radius * 2 }}
      onPointerDown={(e) => {
        if (disabled) return;
        e.stopPropagation();
        activePointer.current = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        updateFromClient(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (disabled || activePointer.current !== e.pointerId) return;
        e.stopPropagation();
        updateFromClient(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (activePointer.current !== e.pointerId) return;
        e.stopPropagation();
        activePointer.current = null;
        setKnobOffset({ x: 0, y: 0 });
        onVectorChange(0, 0);
      }}
      onPointerCancel={() => {
        activePointer.current = null;
        setKnobOffset({ x: 0, y: 0 });
        onVectorChange(0, 0);
      }}
      className="relative rounded-full bg-[#0e131e]/60 border-2 border-amber-500/45 flex items-center justify-center touch-none select-none shadow-xl"
    >
      {/* Directional ticks like PUBG Mobile thumbstick */}
      <span className="absolute top-1.5 text-[9px] text-amber-300/60 pointer-events-none">▲</span>
      <span className="absolute bottom-1.5 text-[9px] text-amber-300/60 pointer-events-none">▼</span>
      <span className="absolute left-2 text-[9px] text-amber-300/60 pointer-events-none">◀</span>
      <span className="absolute right-2 text-[9px] text-amber-300/60 pointer-events-none">▶</span>

      <div
        style={{
          width: 44 * scale,
          height: 44 * scale,
          transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
        }}
        className="rounded-full bg-gradient-to-b from-amber-400 to-amber-600 border-2 border-amber-100/80 shadow-lg pointer-events-none"
      />
    </div>
  );
};
