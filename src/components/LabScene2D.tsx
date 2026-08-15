import React, { useRef, useState } from 'react';
import { DeskItem } from '../types';


import { useEffect as useReactEffect } from 'react';
import { sumLiquidVolumeMl } from '../lib/quantityDisplay';

function useLiquidPhysics(x: number, y: number, containerRot: number) {
  const liquidRef = useRef<SVGRectElement>(null);
  useReactEffect(() => {
    if (liquidRef.current) {
      liquidRef.current.style.transform = `rotate(${-containerRot}rad)`;
    }
  });
  return liquidRef;
}

const pxPerUnit = 140;

const Equipment2D = ({ item, allItems }: { item: DeskItem, allItems: DeskItem[] }) => {
  const containerRot = item.rotation ? item.rotation[2] : 0;
  const liquidRef = useLiquidPhysics(item.position[0], item.position[1], containerRot);
  const { shape, capacity, radius, height } = item.equipment;
  const w = radius * 2 * pxPerUnit;
  const h = height * pxPerUnit;
  
  const totalAmount = item.liquidVolumeMl ?? sumLiquidVolumeMl(item.contents);
  const fillRatio = Math.min(totalAmount / capacity, 1);
  const color = item.liquidColor || 'transparent';

  let path = '';
  if (shape === 'cylinder') {
    path = `M 0,0 L 0,${h} L ${w},${h} L ${w},0`;
  } else if (shape === 'cone_top') {
    path = `M ${w*0.3},0 L ${w*0.3},${h*0.3} L 0,${h} L ${w},${h} L ${w*0.7},${h*0.3} L ${w*0.7},0`;
  } else if (shape === 'sphere_bottom') {
    const neckY = h - w/2;
    path = `M ${w*0.3},0 L ${w*0.3},${neckY} A ${w/2} ${w/2} 0 1 0 ${w*0.7} ${neckY} L ${w*0.7},0`;
  } else if (shape === 'flat_dish') {
    path = `M 0,0 L 0,${h} L ${w},${h} L ${w},0`;
  } else if (shape === 'pipette') {
    path = `M ${w*0.4},0 L ${w*0.4},${h*0.8} L ${w*0.5},${h} L ${w*0.6},${h*0.8} L ${w*0.6},0`;
  } else if (shape === 'mortar') {
    path = `M 0,0 L ${w*0.1},${h} L ${w*0.9},${h} L ${w},0`;
  } else if (shape === 'pestle') {
    path = `M ${w*0.3},0 L ${w*0.3},${h*0.7} A ${w/2} ${w/2} 0 1 0 ${w*0.7} ${h*0.7} L ${w*0.7},0`;
  } else if (shape === 'box') {
    path = `M 0,0 L 0,${h} L ${w},${h} L ${w},0`;
  }

  const isApparatus = ['burner', 'heater', 'meter_temp', 'meter_ph', 'meter_cond', 'balance', 'stirrer', 'tripod', 'sunlight', 'electrodes', 'cooler'].includes(shape);
  if (isApparatus) {
     let content = null;
     if (shape === 'burner') {
        let contentsElement = null;
        if (item.contents && item.contents.length > 0) {
           const solids = item.contents.filter(c => c.chemical.state === 'solid');
           if (solids.length === 1 && solids[0].chemical.name.toLowerCase().includes('magnesium ribbon')) {
              contentsElement = <div className="absolute -top-4 w-[60%] h-2 bg-slate-300 rounded-sm border border-slate-400 rotate-45 z-20 shadow-sm" />;
           } else if (solids.length === 1 && (solids[0].chemical.name.toLowerCase().includes('coal') || solids[0].chemical.name.toLowerCase().includes('charcoal'))) {
              contentsElement = <div className="absolute -top-3 w-[50%] h-[30%] bg-zinc-800 rounded-sm z-20 shadow-sm" />;
           } else if (!item.contents.every(c => c.chemical.state === 'solid')) {
              contentsElement = (
                 <div className="absolute -top-6 w-[80%] h-6 border-2 border-slate-300 bg-white/50 rounded-b-xl flex flex-col justify-end overflow-hidden shadow-sm z-20">
                    <div style={{ backgroundColor: item.liquidColor || '#a0d8ef', height: `${Math.min(100, (item.contents.reduce((s,c)=>s+c.amount,0)/item.equipment.capacity)*100)}%`, width: '100%' }} />
                 </div>
              );
           } else {
              contentsElement = <div className="absolute -top-1 w-[50%] h-2 bg-slate-100 border border-slate-300 rounded-full z-20 shadow-sm" />;
           }
        }

        const isDazzling = item.visualEffect && item.visualEffect.toLowerCase().includes('dazzling');
        const flameColor = isDazzling ? 'text-white drop-shadow-[0_0_10px_rgba(255,255,255,1)]' : 'text-orange-500';
        const flameGlow = isDazzling ? <div className="absolute -top-8 w-16 h-16 bg-white rounded-full blur-xl opacity-80 pointer-events-none z-10" /> : null;

        content = <div style={{width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', position: 'relative'}}>
           {flameGlow}
           {contentsElement}
           {item.isOn && <div className={`animate-pulse text-xl absolute -top-4 z-10 ${flameColor}`}>🔥</div>}
           {item.equipment.name === 'Candle' ? (
              <>
                 <div className="bg-amber-100 w-1/2 h-full rounded-sm border border-amber-200" />
                 <div className="bg-slate-800 w-1 h-2 absolute top-0 z-0" style={{marginTop: '-8px'}} />
              </>
           ) : (
              <>
                 <div className="bg-slate-400 w-1/3 h-2/3 rounded-t-sm" />
                 <div className="bg-slate-700 w-full h-1/3 rounded-sm" />
              </>
           )}
        </div>;
     } else if (shape === 'heater' || shape === 'stirrer') {
        content = <div style={{width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end'}}>
           <div className={`w-full h-1/2 rounded-t-sm ${item.isOn ? (shape === 'heater' ? 'bg-red-500' : 'bg-slate-400') : 'bg-slate-300'}`} />
           <div className="bg-slate-700 w-full h-1/2 rounded-b-sm" />
        </div>;
     } else if (shape === 'meter_temp' || shape === 'meter_ph' || shape === 'meter_cond') {
        let readingText = "";
        let closestItem = null;
        let minDist = 3.0;
        for (const other of allItems) {
           if (other.id !== item.id) {
              const dist = Math.hypot(other.position[0] - item.position[0], other.position[2] - item.position[2]);
              if (dist < minDist) {
                 minDist = dist;
                 closestItem = other;
              }
           }
        }
        
            if (shape === 'meter_temp') {
      readingText = closestItem?.temperature ? `${closestItem.temperature.toFixed(1)}°C` : "22.0°C";
    } else if (shape === 'meter_ph') {
      let ph = 7.0;
      if (closestItem && closestItem.contents) {
         let hPlus = 1e-7;
         let ohMinus = 1e-7;
         let totalVol = closestItem.liquidVolumeMl ?? sumLiquidVolumeMl(closestItem.contents);
         if (totalVol === 0) totalVol = 100; // fallback if only solids are present, assume 100ml water
         
         for (const c of closestItem.contents) {
            const name = c.chemical.name.toLowerCase();
            const formula = c.chemical.formula || "";
            let mm = 100;
            if (name.includes('hydrochloric') || formula === 'HCl') mm = 36.5;
            else if (name.includes('sulfuric') || formula === 'H2SO4') mm = 98;
            else if (name.includes('nitric') || formula === 'HNO3') mm = 63;
            else if (name.includes('sodium hydroxide') || formula === 'NaOH') mm = 40;
            else if (name.includes('potassium hydroxide') || formula === 'KOH') mm = 56;
            else if (name.includes('ammonia') || formula === 'NH3') mm = 17;
            else if (name.includes('acetic') || name.includes('ethanoic') || formula === 'CH3COOH') mm = 60;
            
            const moles = c.amount / mm;
            const molarity = moles / (totalVol / 1000); // mol/L

            if (name.includes('hydrochloric') || formula === 'HCl' || name.includes('nitric') || formula === 'HNO3' || formula === 'HBr' || formula === 'HI' || formula === 'HClO4') {
               hPlus += molarity;
            } else if (name.includes('sulfuric') || formula === 'H2SO4') {
               hPlus += molarity * 2;
            } else if (name.includes('acetic') || formula === 'CH3COOH') {
               hPlus += Math.sqrt(1.8e-5 * molarity);
            } else if (name.includes('hydroxide') || formula === 'NaOH' || formula === 'KOH' || formula === 'LiOH') {
               ohMinus += molarity;
            } else if (formula === 'Ba(OH)2' || formula === 'Ca(OH)2') {
               ohMinus += molarity * 2;
            } else if (name.includes('ammonia') || formula === 'NH3') {
               ohMinus += Math.sqrt(1.8e-5 * molarity);
            }
         }
         
         if (hPlus > ohMinus) {
            hPlus = hPlus - ohMinus;
            ph = -Math.log10(hPlus);
         } else if (ohMinus > hPlus) {
            ohMinus = ohMinus - hPlus;
            ph = 14 + Math.log10(ohMinus);
         }
         
         if (ph < 0) ph = 0;
         if (ph > 14) ph = 14;
      }
      readingText = closestItem ? `pH ${ph.toFixed(2)}` : 'pH --';
    } else if (shape === 'meter_cond') {
      let cond = 0;
      if (closestItem && closestItem.contents) {
         let totalIons = 0;
         let totalVol = closestItem.liquidVolumeMl ?? sumLiquidVolumeMl(closestItem.contents);
         if (totalVol === 0) totalVol = 100;
         for (const c of closestItem.contents) {
            const name = c.chemical.name.toLowerCase();
            if (name.includes('acid') || name.includes('hydroxide') || name.includes('sodium') || name.includes('potassium') || name.includes('chloride') || name.includes('sulfate') || name.includes('nitrate')) {
               totalIons += c.amount;
            }
         }
         const conc = totalIons / totalVol;
         cond = Math.floor(conc * 10000); 
      }
      readingText = closestItem ? `${cond} µS` : '-- µS';
    } else if (shape === 'balance') {
      const w = closestItem ? ((closestItem.liquidVolumeMl ?? sumLiquidVolumeMl(closestItem.contents)) + closestItem.equipment.capacity * 0.1) : 0;
      const tare = item.reading || 0;
      readingText = closestItem ? `${(w - tare).toFixed(2)}g` : '0.00g';
    }

        content = <div style={{width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
           <div className="bg-slate-800 w-full h-1/4 rounded-sm flex items-center justify-center text-[14px] font-bold text-green-400">
             {readingText}
           </div>
           <div className="bg-slate-400 w-1/4 h-3/4 rounded-b-sm" />
        </div>;
     } else if (shape === 'balance') {
        content = <div style={{width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end'}}>
           <div className="bg-slate-300 w-2/3 h-1/4 rounded-t-sm" />
           <div className="bg-slate-700 w-full h-3/4 rounded-b-sm flex items-center justify-center text-[10px] text-green-400">
             {item.reading ? `${item.reading.toFixed(1)}g` : '0.0g'}
           </div>
        </div>;
     
     } else if (shape === 'sunlight') {
        content = <div style={{width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start'}}>
           <div className="w-full h-8 bg-yellow-200 rounded-full flex items-center justify-center border-2 border-yellow-400">
             <span className="text-xl">☀️</span>
           </div>
           {item.isOn && <div className="w-4 h-full bg-yellow-100/50" />}
        </div>;
     
     } else if (shape === 'cooler') {
        content = <div style={{width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start'}}>
           <div className="w-full h-8 bg-blue-100 rounded flex items-center justify-center border border-blue-300">
             <span className="text-xl">🧊</span>
           </div>
        </div>;
     } else if (shape === 'electrodes') {
        content = <div style={{width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start'}}>
           <div className="w-full h-6 bg-gray-800 rounded flex items-center justify-center text-white text-xs font-bold">
             BATTERY {item.isOn ? 'ON' : 'OFF'}
           </div>
           <div className="flex w-full h-full justify-around pt-2">
             <div className="w-1 h-full bg-gray-400" />
             <div className="w-1 h-full bg-gray-400" />
           </div>
        </div>;
     } else if (shape === 'tripod') {
        content = <div style={{width: w, height: h, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
           <div className="bg-slate-700 w-full h-[4px] absolute top-0" />
           <div className="bg-slate-700 w-[4px] h-full ml-1" />
           <div className="bg-slate-700 w-[4px] h-full mr-1" />
        </div>;
     }

     return (
       <div style={{ position: 'relative', width: w, height: h, overflow: 'visible' }}>
         {content}
         {(item.equation || item.visualEffect) && (
           <div
             className="absolute pointer-events-none select-none"
             style={{
               left: '100%',
               transform: 'translateX(8px)',
               bottom: '30%',
               maxWidth: 'min(280px, 40vw)',
               width: 'max-content',
               zIndex: 1000,
             }}
           >
             <div className="bg-white/95 border border-indigo-200 rounded-md shadow-md px-2 py-1 text-left">
               {item.equation && (
                 <div
                   className="text-indigo-800 font-semibold leading-snug break-words"
                   style={{ fontSize: 'clamp(16px, 1.25vw, 24px)', whiteSpace: 'normal', wordBreak: 'break-word' }}
                 >
                   {item.equation}
                 </div>
               )}
               {item.visualEffect && (
                 <div
                   className="text-orange-600 leading-snug break-words"
                   style={{
                     fontSize: 'clamp(13px, 1vw, 18px)',
                     marginTop: item.equation ? '2px' : 0,
                     whiteSpace: 'normal',
                     wordBreak: 'break-word',
                     maxHeight: '3.2em',
                     overflow: 'hidden',
                   }}
                 >
                   {item.visualEffect}
                 </div>
               )}
             </div>
           </div>
         )}
         <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[14px] text-slate-700 whitespace-nowrap font-bold bg-white/80 px-2 rounded">
           {item.equipment.name}
         </div>
       </div>
     );
  }

  if (item.isExploded) {
    return (
      <div className="text-red-500 font-bold text-xs bg-red-50 border border-red-200 rounded p-1 text-center" style={{ width: w, height: h, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        EXPLODED!
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <svg width={w + 4} height={h + 4} viewBox={`-2 -2 ${w+4} ${h+4}`} className="overflow-visible absolute top-0 left-0">
        <defs>
          <clipPath id={`clip-${item.id}`}>
            <path d={path} />
          </clipPath>
        </defs>
        
        {/* Liquid */}
        {fillRatio > 0 && (
          <rect 
            ref={liquidRef}
            x={-w} 
            y={h - h * fillRatio} 
            width={w * 3} 
            height={h * 2} 
            fill={color} 
            clipPath={`url(#clip-${item.id})`}
            opacity={0.8}
            style={{ transformOrigin: `${w/2}px ${h - h * fillRatio}px` }}
          />
        )}
        
        {/* Precipitate */}
        {item.hasPrecipitate && (
          <rect 
             x={-2} 
             y={h - 10} 
             width={w + 4} 
             height={12} 
             fill={item.precipitateColor || '#fff'} 
             clipPath={`url(#clip-${item.id})`}
             opacity={0.9}
          />
        )}
        
        {/* Glass Outline */}
        <path d={path} fill="rgba(136,204,255,0.4)" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Gas bubbles drawn INSIDE the vessel so they stay visible and do not hide under the equation card */}
        {item.gasProduced && (
          <g>
            {[0, 1, 2, 3].map((i) => {
              const baseY = Math.max(8, h * (0.15 + (i % 2) * 0.08));
              const cx = w * (0.3 + (i % 3) * 0.2);
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={baseY}
                  r={3 + (i % 3)}
                  fill={item.gasColor || '#a0d8ef'}
                  opacity={0.7}
                >
                  <animate
                    attributeName="cy"
                    values={`${baseY};${Math.max(2, baseY - h * 0.25)}`}
                    dur={`${1.1 + i * 0.25}s`}
                    begin={`${i * 0.2}s`}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.75;0.15"
                    dur={`${1.1 + i * 0.25}s`}
                    begin={`${i * 0.2}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              );
            })}
          </g>
        )}
      </svg>
      {(item.equation || item.visualEffect) && (
        <div
          className="absolute pointer-events-none select-none"
          style={{
            // Side label: avoids covering gas bubbles and reduces top clipping
            left: '100%',
            transform: 'translateX(8px)',
            bottom: '40%',
            maxWidth: 'min(280px, 40vw)',
            width: 'max-content',
            zIndex: 1000,
          }}
        >
          <div className="bg-white/95 border border-indigo-200 rounded-md shadow-md px-2 py-1 text-left">
            {item.equation && (
              <div
                className="text-indigo-800 font-semibold leading-snug break-words"
                style={{
                  fontSize: 'clamp(16px, 1.25vw, 24px)',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                }}
              >
                {item.equation}
              </div>
            )}
            {item.visualEffect && (
              <div
                className="text-orange-600 leading-snug break-words"
                style={{
                  fontSize: 'clamp(13px, 1vw, 18px)',
                  marginTop: item.equation ? '2px' : 0,
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  maxHeight: '3.2em',
                  overflow: 'hidden',
                }}
              >
                {item.visualEffect}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[18px] text-slate-700 whitespace-nowrap font-bold bg-white/80 px-2 rounded">
        {item.equipment.name}
      </div>
    </div>
  );
};

export default function LabScene2D({
  deskItems,
  onEquipmentClick,
  onEquipmentMove,
  activeItemId,
  setActiveItemId,
  transformMode
}: {
  deskItems: DeskItem[],
  onEquipmentClick: (item: DeskItem) => void,
  onEquipmentMove: (id: string, pos: [number, number, number], rot: [number, number, number], is2D?: boolean) => void,
  activeItemId: string | null,
  setActiveItemId: (id: string | null) => void,
  transformMode: 'translate' | 'rotate'
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const [isRotating, setIsRotating] = useState(false);
  const [rotateStart, setRotateStart] = useState({ x: 0, initialAngle: 0 });

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setActiveItemId(id);
    
    const item = deskItems.find(i => i.id === id);
    if (!item) return;

    if (transformMode === 'translate') {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const pointerX = e.clientX - rect.left;
        const pointerY = e.clientY - rect.top;
        
        const itemScreenX = rect.width / 2 + item.position[0] * pxPerUnit;
        const itemY = item.position2DY !== undefined ? item.position2DY : item.position[1];
        const itemScreenY = rect.height - 40 - itemY * pxPerUnit - (item.equipment.height * pxPerUnit);
        
        setDragOffset({
          x: pointerX - itemScreenX,
          y: pointerY - itemScreenY
        });
      }
      setDraggingItem(id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else if (transformMode === 'rotate') {
      setIsRotating(true);
      setRotateStart({ x: e.clientX, initialAngle: item.rotation ? item.rotation[2] : 0 });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingItem && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      
      const itemScreenX = pointerX - dragOffset.x;
      const itemScreenY = pointerY - dragOffset.y;
      
      const newX = (itemScreenX - rect.width / 2) / pxPerUnit;
      
      const item = deskItems.find(i => i.id === draggingItem);
      if (item) {
        const h = item.equipment.height * pxPerUnit;
        const newY = (rect.height - 40 - itemScreenY - h) / pxPerUnit;
        onEquipmentMove(draggingItem, [newX, Math.max(0, newY), item.position[2]], item.rotation || [0,0,0], true);
      }
    } else if (isRotating && activeItemId) {
      const deltaX = e.clientX - rotateStart.x;
      const newAngle = rotateStart.initialAngle - deltaX * 0.02; // negate to match mouse direction visually
      const item = deskItems.find(i => i.id === activeItemId);
      if (item) {
        onEquipmentMove(activeItemId, item.position, [item.rotation?.[0] || 0, item.rotation?.[1] || 0, newAngle]);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingItem || isRotating) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
      setDraggingItem(null);
      setIsRotating(false);
    }
  };

  return (
    <div 
      ref={containerRef}
      className="w-full h-full bg-slate-50 relative overflow-visible touch-none select-none" 
      onPointerDown={() => setActiveItemId(null)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 2D Background / Environment */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-200 to-slate-100 pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-10 bg-slate-800 pointer-events-none shadow-[0_-5px_15px_rgba(0,0,0,0.1)] border-t border-slate-700 flex items-center px-4">
         <span className="text-slate-400 font-mono text-xs opacity-50 uppercase tracking-widest">Lab Desk</span>
      </div>
      
      {/* 2D Equipments */}
      {deskItems.map(item => {
        const x = item.position[0];
        const y = item.position2DY !== undefined ? item.position2DY : item.position[1];
        // Higher base z-index so equation/visual labels above the vessel are not
        // painted underneath neighboring equipment or UI cards.
        const zIndex = activeItemId === item.id ? 500 : Math.round(100 + y * 10);
        
        return (
          <div
            key={item.id}
            className={`absolute cursor-pointer transition-shadow origin-bottom ${activeItemId === item.id ? 'drop-shadow-[0_0_12px_rgba(79,70,229,0.5)]' : 'drop-shadow-md hover:drop-shadow-lg'}`}
            style={{
              left: '50%',
              bottom: '40px',
              transform: `translate(calc(-50% + ${x * pxPerUnit}px), ${-y * pxPerUnit}px) rotate(${item.rotation ? item.rotation[2] * (180/Math.PI) : 0}deg)`,
              zIndex,
              overflow: 'visible',
            }}
            onPointerDown={(e) => handlePointerDown(e, item.id)}
            onClick={(e) => {
              e.stopPropagation();
              onEquipmentClick(item);
            }}
          >
            <Equipment2D item={item} allItems={deskItems} />
          </div>
        )
      })}
    </div>
  );
}
