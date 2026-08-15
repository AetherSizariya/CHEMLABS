import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Beaker, FlaskConical, Droplet, Plus, Trash2, AlertCircle, Minimize2, Maximize2, Move, RotateCcw, Box, Layers, Undo2, Settings, X, ArrowRight, Scale, Power, Flame, Menu, ChevronLeft, ChevronDown, ChevronUp, Thermometer, Activity, Zap, FileWarning, Search, TestTube, TestTubes, FlaskRound, Square, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { audio } from "./lib/audio";
import { CHEMICALS, EQUIPMENTS, Chemical, Equipment, DeskItem } from './types';
import { db } from './lib/firebase';
import { buildReactionCachePayload, makeReactionCode, cleanFormula } from './lib/reactionProfile';
import { formatQuantity, sumLiquidVolumeMl, isAqueousState } from './lib/quantityDisplay';
import { calculateDeterministicQuantities, canonicalFormula } from './lib/stoichiometry';
import { sanitizeFirestoreData } from './lib/firestoreSafe';
import Markdown from 'react-markdown';
import { collection, onSnapshot, addDoc, query, doc, setDoc } from 'firebase/firestore';
const LabScene = lazy(() => import('./components/LabScene'));
const LabScene2D = lazy(() => import('./components/LabScene2D'));

/** Prefer authoritative unit from the chemistry engine. */
function resolveProductUnit(chemInfo: any, normalizedState: 'solid' | 'liquid' | 'gas'): 'ml' | 'g' {
  if (chemInfo?.unit === 'g' || chemInfo?.unit === 'ml') return chemInfo.unit;
  if (normalizedState === 'solid' || isAqueousState(chemInfo?.state)) return 'g';
  return 'ml';
}

/** Merge identical chemicals by canonical formula at the UI/container boundary.
 * For solutions, merge by physical moles + total volume and carry the resulting
 * effective concentration forward so future reactions do not lose concentration
 * information.
 */
function mergeContentsByFormula(contents: any[]): any[] {
  const merged = new Map<string, any>();

  const getConcentration = (content: any): number | null => {
    const candidates = [
      content?.concentration,
      content?.molarity,
      content?.chemical?.concentration,
      content?.chemical?.molarity,
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  for (const content of contents || []) {
    const formula = canonicalFormula(content?.chemical?.formula || content?.formula || '');
    if (!formula) continue;

    const previous = merged.get(formula);
    if (!previous) {
      merged.set(formula, {
        ...content,
        chemical: { ...(content.chemical || {}), formula },
      });
      continue;
    }

    const previousUnit = previous.unit || 'ml';
    const currentUnit = content.unit || 'ml';
    const previousVolume = Number(previous.volumeMl ?? (previousUnit === 'ml' ? previous.amount : 0)) || 0;
    const currentVolume = Number(content.volumeMl ?? (currentUnit === 'ml' ? content.amount : 0)) || 0;
    const previousMoles = Number(previous.moles);
    const currentMoles = Number(content.moles);
    const previousConcentration = getConcentration(previous);
    const currentConcentration = getConcentration(content);

    if (previousUnit === 'ml' && currentUnit === 'ml') {
      const totalVolume = previousVolume + currentVolume;
      let totalMoles =
        (Number.isFinite(previousMoles) ? previousMoles : (previousConcentration != null ? previousVolume / 1000 * previousConcentration : NaN)) +
        (Number.isFinite(currentMoles) ? currentMoles : (currentConcentration != null ? currentVolume / 1000 * currentConcentration : NaN));

      // If neither entry carries explicit concentration/moles, preserve the
      // simulator's 1.00 M fallback rather than inventing a different value.
      if (!Number.isFinite(totalMoles) && totalVolume > 0) {
        totalMoles = totalVolume / 1000;
      }

      previous.amount = totalVolume;
      previous.volumeMl = totalVolume;
      if (Number.isFinite(totalMoles)) {
        previous.moles = totalMoles;
        previous.massG = Number.isFinite(Number(previous.massG)) && Number.isFinite(Number(content.massG))
          ? Number(previous.massG) + Number(content.massG)
          : previous.massG;
        const effectiveConcentration = totalVolume > 0 ? totalMoles / (totalVolume / 1000) : undefined;
        if (effectiveConcentration != null && Number.isFinite(effectiveConcentration)) {
          previous.concentration = effectiveConcentration;
          previous.molarity = effectiveConcentration;
        }
      }
    } else if (previousUnit === currentUnit) {
      previous.amount = Number(previous.amount || 0) + Number(content.amount || 0);
      if (previous.moles != null || content.moles != null) {
        previous.moles = Number(previous.moles || 0) + Number(content.moles || 0);
      }
      if (previous.massG != null || content.massG != null) {
        previous.massG = Number(previous.massG || 0) + Number(content.massG || 0);
      }
      if (previous.volumeMl != null || content.volumeMl != null) {
        previous.volumeMl = Number(previous.volumeMl || 0) + Number(content.volumeMl || 0);
      }
    } else if (content.moles != null || previous.moles != null) {
      // Different display units are never added numerically. Combine physical
      // moles/mass only and retain one display representation.
      previous.moles = Number(previous.moles || 0) + Number(content.moles || 0);
      previous.massG = Number(previous.massG || 0) + Number(content.massG || 0);
    }

    merged.set(formula, previous);
  }

  return Array.from(merged.values());
}


// Heuristic: does this container currently have hydrogen gas evolving from it?
// (There's no explicit "gas chemical" field on DeskItem, so we look for hydrogen
// mentioned in the reaction's equation/visual description.)
const isEmittingHydrogenGas = (item: DeskItem) => {
  if (!item.gasProduced) return false;
  const text = `${item.equation || ''} ${item.visualEffect || ''} ${item.gasColor || ''}`.toLowerCase();
  if (text.includes('hydrogen')) return true;
  // Match H2 as a free species, but not H2O / H2O2 / etc.
  if (/\bh2\b(?![a-z0-9])/i.test(text)) return true;
  if (text.includes('h₂') || text.includes('h2(g)')) return true;
  // Also check contents for residual hydrogen-like entries that may have leaked in
  for (const c of item.contents || []) {
    const n = (c.chemical?.name || '').toLowerCase();
    const f = (c.chemical?.formula || '').toLowerCase().replace(/\s+/g, '');
    if (n.includes('hydrogen') && !n.includes('peroxide') && !n.includes('chloride') && !n.includes('sulfide')) return true;
    if (f === 'h2' || f === 'h₂') return true;
  }
  return false;
};



export default function App() {
  const [deskItems, setDeskItems] = useState<DeskItem[]>([]);
  const [history, setHistory] = useState<DeskItem[][]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [chemicalSearch, setChemicalSearch] = useState('');
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [showAllEquipment, setShowAllEquipment] = useState(false);
  const [showAllChemicals, setShowAllChemicals] = useState(false);
  
  const [selectedChemical, setSelectedChemical] = useState<Chemical | null>(null);
  const [sourceEquipmentId, setSourceEquipmentId] = useState<string | null>(null);
  
  const [pourAmount, setPourAmount] = useState<number>(10);
  const [beakerPourAmount, setBeakerPourAmount] = useState<number>(10);
  const [isPouring, setIsPouring] = useState(false);
  const [loadingText, setLoadingText] = useState('Simulating reaction...');
  const [isNotesMinimized, setIsNotesMinimized] = useState(false);
  
  const [userNotes, setUserNotes] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  useEffect(() => {
    // Firebase is non-essential to the first paint. Start the live notes
    // listener after the browser has had a chance to render the laboratory.
    const start = () => {
      const unsub = onSnapshot(doc(db, 'lab', 'notes'), (docSnap) => {
        if (docSnap.exists()) setUserNotes(docSnap.data().text || '');
      });
      return unsub;
    };
    let unsubscribe: (() => void) | undefined;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    if ('requestIdleCallback' in window) {
      idleHandle = (window as any).requestIdleCallback(() => { unsubscribe = start(); }, { timeout: 1500 });
    } else {
      timeoutHandle = window.setTimeout(() => { unsubscribe = start(); }, 250);
    }
    return () => {
      if (idleHandle !== undefined) (window as any).cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      unsubscribe?.();
    };
  }, []);

  const handleNotesChange = (e) => {
    const newText = e.target.value;
    setUserNotes(newText);
    setDoc(doc(db, 'lab', 'notes'), sanitizeFirestoreData({ text: newText }), { merge: true });
  };
  const [logs, setLogs] = useState<{id: string, msg: string, isError?: boolean}[]>([]);
  
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');
  const [viewMode, setViewMode] = useState<'3D' | '2D'>('3D');
  const [uiMode, setUiMode] = useState<'floating' | 'bar'>('floating');

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [newApiKey, setNewApiKey] = useState('');
  const [availableChemicals, setAvailableChemicals] = useState<Chemical[]>(CHEMICALS);
  const [newChemicalRequest, setNewChemicalRequest] = useState('');
  const [isGeneratingChemical, setIsGeneratingChemical] = useState(false);
  const [isSynthOpen, setIsSynthOpen] = useState(false);
  const [reactionTime, setReactionTime] = useState('end');
  const [reactionRate, setReactionRate] = useState<'slow' | 'normal' | 'fast'>('normal');
  const reactionRateRef = React.useRef(reactionRate);
  useEffect(() => { reactionRateRef.current = reactionRate; }, [reactionRate]);

  useEffect(() => {
    // The built-in CHEMICALS list is enough for first render. Custom chemicals
    // can hydrate from Firestore after the initial UI is interactive.
    const start = () => {
      const q = query(collection(db, 'chemicals'));
      return onSnapshot(q, (snapshot) => {
      const dbChemicals: Chemical[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.name) return;
        dbChemicals.push({
          id: doc.id,
          name: data.name,
          formula: data.formula,
          defaultColor: data.defaultColor,
          category: data.category,
          state: data.state
        });
      });
      
      setAvailableChemicals(() => {
          // Formula-first identity collapses "Sodium Chloride" / "NaCl (aq)" etc.
          const map = new Map<string, Chemical>();
          const keyOf = (c: Chemical) => {
            const formula = cleanFormula(c.formula || '');
            if (formula) return `f:${formula}`;
            return `n:${String(c.name || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
          };
          CHEMICALS.forEach(c => map.set(keyOf(c), c));
          dbChemicals.forEach(c => {
            const key = keyOf(c);
            if (!map.has(key)) map.set(key, c);
          });
          return Array.from(map.values());
      });
      }, (error) => {
        console.error('Firestore snapshot error:', error);
      });
    };
    let unsubscribe: (() => void) | undefined;
    const schedule = 'requestIdleCallback' in window
      ? (window as any).requestIdleCallback(() => { unsubscribe = start(); }, { timeout: 1500 })
      : window.setTimeout(() => { unsubscribe = start(); }, 250);
    return () => {
      if (typeof schedule === 'number') window.clearTimeout(schedule);
      else (window as any).cancelIdleCallback?.(schedule);
      unsubscribe?.();
    };
  }, []);

  const chemicalIdentityKey = (c: { name?: string; formula?: string }) => {
    const formula = cleanFormula(c.formula || '');
    if (formula) return `f:${formula}`;
    return `n:${String(c.name || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
  };

  const isKnownChemical = (chemical: { name?: string; formula?: string }) => {
    const key = chemicalIdentityKey(chemical);
    if (CHEMICALS.some(c => chemicalIdentityKey(c) === key)) return true;
    return availableChemicals.some(c => chemicalIdentityKey(c) === key);
  };

  /** Persist a user-synthesized chemical. Skips anything already known by formula. */
  const saveChemicalToDb = async (chemical: Omit<Chemical, 'id'>) => {
      if (isKnownChemical(chemical)) return;
      try {
          const formula = cleanFormula(chemical.formula || '');
          const id = formula
            ? `f_${formula}`
            : chemical.name.toLowerCase().replace(/\s+/g, '-');
          await setDoc(doc(db, 'chemicals', id), sanitizeFirestoreData({
              name: chemical.name,
              formula: chemical.formula,
              defaultColor: chemical.defaultColor,
              category: chemical.category,
              state: chemical.state
          }), { merge: true });
      } catch (e) {
          console.error("Error adding chemical to db:", e);
      }
  };

  useEffect(() => {
    const storedKeys = localStorage.getItem('gemini_api_keys');
    if (storedKeys) {
      try {
        setApiKeys(JSON.parse(storedKeys));
      } catch (e) {}
    }
  }, []);

  
  useEffect(() => {
    const interval = setInterval(() => {
      setDeskItems(currentItems => {
        let changed = false;
        const ignitedThisTick: string[] = [];
        const newItems = currentItems.map(item => {
          let temp = item.temperature || 25;
          let heated = false;
          let cooled = false;
          let itemChanged = false;
          
          const rate = reactionRateRef.current;
          let tempMultiplier = 1;
          if (rate === 'slow') tempMultiplier = 0.2;
          if (rate === 'fast') tempMultiplier = 5;
          if (item.isOn && (item.equipment.shape === 'burner' || item.equipment.shape === 'heater')) {
             heated = true;
             const targetTemp = item.equipment.shape === 'burner' ? 500 : 200;
             if (temp < targetTemp) {
                temp = Math.min(targetTemp, temp + (0.2 * tempMultiplier));
                changed = true; itemChanged = true;
             }
          }

          // Check if near any active heater or cooler
          let nearOpenFlame = false;
          for (const other of currentItems) {
            if (other.isOn && other.id !== item.id) {
              // Horizontal desk distance (X/Z). In 2D mode Z is often 0 for all
              // items, so also consider the 2D vertical layout coordinate.
              const dx = item.position[0] - other.position[0];
              const dz = item.position[2] - other.position[2];
              const distXZ = Math.hypot(dx, dz);
              const yItem = item.position2DY !== undefined ? item.position2DY : item.position[1];
              const yOther = other.position2DY !== undefined ? other.position2DY : other.position[1];
              const dist2D = Math.hypot(dx, yItem - yOther);
              // Use the smaller of the two so both 3D and 2D layouts work.
              const dist = Math.min(distXZ, dist2D);
              if (dist < 3.0) {
                if (other.equipment.shape === 'heater' || other.equipment.shape === 'burner') {
                  heated = true;
                  const targetTemp = other.equipment.shape === 'burner' ? 500 : 200;
                  if (temp < targetTemp) {
                     temp = Math.min(targetTemp, temp + (0.2 * tempMultiplier));
                     changed = true; itemChanged = true;
                  }
                } else if (other.equipment.shape === 'cooler') {
                  cooled = true;
                  const targetTemp = -10;
                  if (temp > targetTemp) {
                     temp = Math.max(targetTemp, temp - (0.2 * tempMultiplier));
                     changed = true; itemChanged = true;
                  }
                }
              }
              // A candle/burner needs to be brought right up next to the vessel
              // (not just "in the room") to ignite escaping hydrogen gas.
              // Candles are shape 'burner' (see types EQUIPMENTS) and are the
              // primary intended flame source for the hydrogen pop test.
              // Slightly larger radius so the test is reliable in both view modes.
              if ((other.equipment.interactionRole === 'candle' || other.equipment.interactionRole === 'burner' || other.equipment.name === 'Candle') && other.isOn && dist < 1.8) {
                nearOpenFlame = true;
              }
            }
          }
          
          if (!heated && !cooled) {
             if (temp > 25) {
               temp -= (temp - 25) * 0.05; // cool down
               if (temp < 25.1) temp = 25;
               changed = true; itemChanged = true;
             } else if (temp < 25) {
               temp += (25 - temp) * 0.05; // warm up
               if (temp > 24.9) temp = 25;
               changed = true; itemChanged = true;
             }
          }

          let hydrogenIgnited = item.hydrogenIgnited;
          let gasProduced = item.gasProduced;
          let equation = item.equation;
          let visualEffect = item.visualEffect;
          if (!hydrogenIgnited && nearOpenFlame && isEmittingHydrogenGas(item)) {
             hydrogenIgnited = true;
             gasProduced = false; // the hydrogen has burned off with a pop
             // Deterministic hydrogen combustion — do NOT call Gemini.
             equation = '2H₂ + O₂ → 2H₂O';
             visualEffect = 'Sharp pop; hydrogen burns with a pale blue flame';
             ignitedThisTick.push(item.id);
             changed = true; itemChanged = true;
          } else if (!isEmittingHydrogenGas(item) && item.hydrogenIgnited) {
             // Reset so a fresh batch of hydrogen can pop again later
             hydrogenIgnited = false;
             changed = true; itemChanged = true;
          }

          if (itemChanged) {
             return { ...item, temperature: temp, hydrogenIgnited, gasProduced, equation, visualEffect };
          }
          return item;
        });

        if (ignitedThisTick.length > 0) {
          audio.playPop();
          addLog(`Hydrogen gas ignites with a pop near the open flame!`);
          addLog(`Equation: 2H₂ + O₂ → 2H₂O`);
        }

        return changed ? newItems : currentItems;
      });
    }, 1000); // 1 tick per second
    return () => clearInterval(interval);
  }, []);

  const createReactionCacheKey = async (input: string): Promise<string> => {
    const webCrypto = globalThis.crypto;
    if (webCrypto?.subtle) {
      const data = new TextEncoder().encode(input);
      const digest = await webCrypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    // Deterministic non-cryptographic fallback. This value is only used as a
    // Firestore document ID; it is not used for authentication or security.
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= code + i;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
    const u32 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
    return `${u32(h1)}${u32(h2)}${u32(h1 ^ h2)}${u32(Math.imul(h1, h2))}`;
  };

  const fetchReaction = async (payload: any) => {
    const cachePayload = buildReactionCachePayload(payload);
    const canonicalJson = JSON.stringify(cachePayload);
    const hash = await createReactionCacheKey(canonicalJson);
    const reactionCode = makeReactionCode(hash);

    try {
      const { getDoc, doc } = await import('firebase/firestore');
      const docRef = doc(db, 'reactions', hash);
      setLoadingText('Checking reaction database...');
      const cachedDoc = await getDoc(docRef);

      if (cachedDoc.exists()) {
        const cached = cachedDoc.data() as any;
        // Reuse equation/visuals; recompute quantities for the current pour amounts.
        if (cached?.chemicalEquation) {
          const allChemicals = [
            ...(Array.isArray(payload?.sourceChemicals) ? payload.sourceChemicals : []),
            ...(Array.isArray(payload?.targetChemicals) ? payload.targetChemicals : []),
          ];
          const deterministic = calculateDeterministicQuantities(
            cached.chemicalEquation,
            allChemicals,
            cached.resultingChemicals || [],
            Number(payload?.temperature || 25),
            Number(payload?.pressure || 1),
            Number.isFinite(Number(payload?.sourceLiquidVolumeMl)) && Number.isFinite(Number(payload?.targetLiquidVolumeMl))
              ? Number(payload.sourceLiquidVolumeMl) + Number(payload.targetLiquidVolumeMl)
              : undefined
          );
          if (deterministic) {
            setLoadingText('Using stored reaction (recomputed quantities)...');
            return {
              ...cached,
              ...deterministic,
              gasVolumeMl: deterministic.gasProduced ? (deterministic.gasVolumeMl ?? 0) : 0,
              cached: true,
              reactionCode: cached.reactionCode || reactionCode,
            };
          }
        }
      }

      setLoadingText('Simulating reaction...');
      const response = await fetch('/api/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, reactionCode }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `API request failed (HTTP ${response.status})`);
      }
      return await response.json();
    } catch (e) {
      throw e;
    }
  };

  const saveApiKeys = (keys: string[]) => {
    setApiKeys(keys);
    localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
  };

  const handleSetDeskItems = (newItems: DeskItem[] | ((prev: DeskItem[]) => DeskItem[])) => {
    setDeskItems(prev => {
      const next = typeof newItems === 'function' ? newItems(prev) : newItems;
      return next;
    });
  };

  const saveHistory = () => {
    setHistory(h => [...h, deskItems].slice(-20));
  };

  const handleUndo = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(history.slice(0, -1));
      setDeskItems(prev);
      setActiveItemId(null);
      setSourceEquipmentId(null);
    }
  };

  const addLog = (msg: string, isError = false) => {
    setLogs(prev => [{ id: Math.random().toString(), msg, isError }, ...prev].slice(0, 10));
  };

  const addEquipmentToDesk = (equip: Equipment) => {
    if (deskItems.length >= 10) {
      addLog("Desk is full! Max 10 items allowed.", true);
      return;
    }
    const index = deskItems.length;
    // Stagger spawn positions slightly around the center so they don't exactly overlap
    const offset = deskItems.length * 0.2;
    const x = viewMode === '2D' ? offset - 1 : offset - 0.5;
    const z = viewMode === '2D' ? 0 : offset + 1; // Spawn in front of the camera focus point

    const newItem: DeskItem = {
      id: Math.random().toString(36).substring(7),
      equipment: equip,
      contents: [],
      liquidColor: '#ffffff',
      temperature: 25,
      position: [x, 0, z],
      rotation: [0, 0, 0],
      liquidVolumeMl: 0
    };
    saveHistory(); setDeskItems([...deskItems, newItem]);
    addLog(`Placed ${equip.name} on the desk.`);
  };

  const handleEquipmentMove = (id: string, newPosition: [number, number, number], newRotation: [number, number, number], is2D: boolean = false) => {
    setDeskItems(prev => {
      const otherItems = prev.filter(i => i.id !== id);
      
      let newY = 0;
      for (const other of otherItems) {
        if (['tripod', 'heater', 'stirrer', 'balance', 'burner', 'box', 'cooler'].includes(other.equipment.shape)) {
          const dist = Math.hypot(other.position[0] - newPosition[0], other.position[2] - newPosition[2]);
          if (dist < other.equipment.radius) {
            newY = other.equipment.height;
          }
        }
      }
      
      return prev.map(item => item.id === id ? { 
        ...item, 
        position: [newPosition[0], newY, newPosition[2]], 
        position2DY: is2D ? newPosition[1] : (item.position2DY !== undefined ? item.position2DY : newY),
        rotation: newRotation 
      } : item);
    });
  };

  
  const handleProcess = async (action: 'heat' | 'stir' | 'photolyze' | 'electrolyze' | 'cool', equipmentId: string) => {
     const heater = deskItems.find(i => i.id === equipmentId);
     if (!heater) return;

     // EQUIPMENT ACTIONS ≠ AUTOMATIC CHEMICAL REACTIONS.
     // Only invoke the reaction engine when there is actual chemical content
     // that can participate. Empty burner/candle ignition is flame + heat only.
     let itemOnTop = deskItems.find(i =>
       i.id !== heater.id &&
       Math.hypot(i.position[0] - heater.position[0], i.position[2] - heater.position[2]) < Math.max(heater.equipment.radius, 0.5)
     );
     if (!itemOnTop || itemOnTop.contents.length === 0) {
        if (heater.contents.length > 0) {
           itemOnTop = heater;
        } else {
           // No chemicals present — do not call Gemini. Burner/candle already
           // show flame and heat via isOn + the temperature tick.
           return;
        }
     }

     // Candle is a flame source for hydrogen detection only. Never run the
     // generic reaction engine merely because a candle was lit, even if some
     // empty vessel is nearby.
     if (heater.equipment.interactionRole === 'candle' && action === 'heat') {
        return;
     }
     
     setIsPouring(true);
     
     let actionVerb = 'Heating';
     if (action === 'stir') actionVerb = 'Stirring';
     if (action === 'photolyze') actionVerb = 'Photolyzing (UV)';
     if (action === 'electrolyze') actionVerb = 'Electrolyzing';
     if (action === 'cool') actionVerb = 'Cooling';
     addLog(`${actionVerb} ${itemOnTop.equipment.name}...`);

     
     try {
        const data = await fetchReaction({ 
            action,
            targetEquipment: itemOnTop.equipment.name,
            targetChemicals: itemOnTop.contents,
            sourceLiquidVolumeMl: 0,
            targetLiquidVolumeMl: Number.isFinite(Number(itemOnTop.liquidVolumeMl))
              ? Number(itemOnTop.liquidVolumeMl)
              : sumLiquidVolumeMl(itemOnTop.contents),
            temperature: itemOnTop.temperature || 25,
            reactionTime: reactionTime,
              reactionRate: reactionRate,
            
            apiKeys: apiKeys
           });
        
        saveHistory();
        setDeskItems(prev => prev.map(item => {
          if (item.id === itemOnTop!.id) {
            if (data.isExplosive) {
              audio.playExplosion();
              return { ...item, isExploded: true, visualEffect: data.visualEffect };
            }
            if (data.isPop) {
              audio.playPop();
            } else if (data.reactionOccurred) {
              audio.playMix(); setTimeout(() => audio.stopMix(), 3000);
            }
            const calculatedResults = data.resultingChemicals || null;
            return {
              ...item,
              contents: calculatedResults ? mergeContentsByFormula(calculatedResults
                .filter((chemInfo: any) => {
                  const s = String(chemInfo?.state || '').toLowerCase();
                  if (s === 'gas' || s === 'g') return false;
                  // Drop zero-mass solids left over from failed quantity paths
                  if ((s === 'solid' || s === 's') && !(Number(chemInfo?.amount) > 0)) return false;
                  return true;
                })
                .map((chemInfo: any) => {
                  const normalizedState: 'solid' | 'liquid' | 'gas' = chemInfo.state === 'solid' ? 'solid' : chemInfo.state === 'gas' ? 'gas' : 'liquid';
                  const chem = { id: chemInfo.name.toLowerCase().replace(/\s+/g, '-'), name: chemInfo.name, formula: chemInfo.formula, defaultColor: chemInfo.defaultColor, category: chemInfo.category, state: normalizedState };
                  // Do NOT write reaction products into the chemicals catalog — that caused sidebar duplication.
                  return {
                    chemical: chem,
                    amount: chemInfo.amount !== undefined ? chemInfo.amount : 0,
                    unit: resolveProductUnit(chemInfo, normalizedState),
                    moles: chemInfo.moles,
                    massG: chemInfo.massG,
                    volumeMl: chemInfo.volumeMl
                  };
              })) : item.contents,
              liquidColor: data.liquidColor || item.liquidColor,
              visualEffect: data.visualEffect,
              gasProduced: data.gasProduced,
              gasColor: data.gasColor,
              hasPrecipitate: data.hasPrecipitate,
              precipitateColor: data.precipitateColor,
              equation: data.chemicalEquation,
              liquidVolumeMl: data.resultingLiquidVolumeMl ?? (item.liquidVolumeMl ?? sumLiquidVolumeMl(item.contents)),
              temperature: item.temperature ? item.temperature + (data.temperatureChange || 0) : 25 + (data.temperatureChange || 0)
            };
          }
          return item;
        }));
        if (data.chemicalEquation) addLog(`Equation: ${data.chemicalEquation}`);
        if (data.visualEffect) addLog(`Visual: ${data.visualEffect}`);
        if (data.gasProduced) {
          const startAmt = itemOnTop.contents.reduce((s, c) => s + c.amount, 0);
          const gasVol = data.gasVolumeMl;
          if (typeof gasVol === 'number') {
            addLog(`Gas Produced (~${Math.round(gasVol)} mL at ${data.gasTemperatureC || 25}°C, ${data.gasPressureAtm || 1} atm — calculated from stoichiometry).`, false);
          } else {
            addLog(`Gas Produced!`, false);
          }
        }
        if (data.isExplosive) addLog(`EXPLOSION in ${itemOnTop.equipment.name}!`, true);
        if (!data.visualEffect && !data.chemicalEquation && !data.gasProduced && !data.isExplosive) addLog('Process completed.');
     } catch (err: any) {
        addLog(`Error: ${err.message}`, true);
     } finally {
        setIsPouring(false);
     }
  };

  const handleGenerateChemical = async (requestText = newChemicalRequest) => {
    const request = requestText.trim();
    if (!request) return;
    setIsGeneratingChemical(true);
    addLog(`Requesting new chemical: ${request}...`);
    try {
      const res = await fetch('/api/generate-chemical', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: request,
           apiKeys: apiKeys,
        })
      });
      if (!res.ok) {
        throw new Error((await res.json()).error || 'Failed to generate chemical');
      }
      const data = await res.json();
      
      const newChem: Chemical = {
        id: 'gen_' + Date.now(),
        name: data.name,
        formula: data.formula,
        defaultColor: data.defaultColor,
        category: data.category,
        state: data.state
      };
      
      await saveChemicalToDb(newChem);
      // UI updates automatically because of onSnapshot listener
      addLog(`Added new chemical: ${newChem.name} (${newChem.formula})`);
      setNewChemicalRequest('');
    } catch (err: any) {
      console.error(err);
      addLog(`Error generating chemical: ${err.message}`, true);
    } finally {
      setIsGeneratingChemical(false);
    }
  };

  const handleEquipmentClick = async (targetItem: DeskItem) => {
    if (targetItem.isExploded) {
      addLog("Cannot pour into destroyed equipment.", true);
      return;
    }
    if ((targetItem.equipment.capacity || 0) === 0) {
      if (sourceEquipmentId || selectedChemical) {
        addLog(`${targetItem.equipment.name} cannot hold liquids.`, true);
      }
      if (sourceEquipmentId) setSourceEquipmentId(null);
      return;
    }

    if (sourceEquipmentId && sourceEquipmentId !== targetItem.id) {
       // POUR FROM EQUIPMENT TO EQUIPMENT
       const sourceItem = deskItems.find(i => i.id === sourceEquipmentId);
       if (!sourceItem) {
          setSourceEquipmentId(null);
          return;
       }

       const totalSourceAmount = sourceItem.contents.reduce((sum, c) => sum + c.amount, 0);
       const actualPourAmount = Math.min(beakerPourAmount, totalSourceAmount);

       if (actualPourAmount <= 0) {
          addLog("Source equipment is empty.", true);
          setSourceEquipmentId(null);
          return;
       }

       const currentTotalTargetAmount = targetItem.contents.reduce((sum, c) => sum + c.amount, 0);
       if (currentTotalTargetAmount + actualPourAmount > targetItem.equipment.capacity) {
         addLog(`Cannot pour ${actualPourAmount} units. ${targetItem.equipment.name} overflows!`, true);
         setSourceEquipmentId(null);
         return;
       }

       const pourFraction = actualPourAmount / totalSourceAmount;
       const sourceLiquidVolumeMl = Number.isFinite(Number(sourceItem.liquidVolumeMl))
         ? Number(sourceItem.liquidVolumeMl)
         : sumLiquidVolumeMl(sourceItem.contents);
       const transferredLiquidVolumeMl = sourceLiquidVolumeMl * pourFraction;

       const pouredChemicals = sourceItem.contents.map(c => ({
           ...c,
           amount: Number(c.amount || 0) * pourFraction,
           ...(c.volumeMl != null ? { volumeMl: Number(c.volumeMl || 0) * pourFraction } : {}),
           ...(c.moles != null ? { moles: Number(c.moles || 0) * pourFraction } : {}),
           ...(c.massG != null ? { massG: Number(c.massG || 0) * pourFraction } : {}),
       }));

       const uniqueChemicals = new Set([...pouredChemicals, ...targetItem.contents].map(c => canonicalFormula(c?.chemical?.formula || c?.formula || c?.chemical?.name || c?.name)));
       const skipAPI = targetItem.contents.length === 0 || uniqueChemicals.size === 1;

       saveHistory();
       
       if (skipAPI) {
           addLog(`Poured ${actualPourAmount.toFixed(1)} units from ${sourceItem.equipment.name} into ${targetItem.equipment.name}.`);
           setDeskItems(prev => prev.map(item => {
               if (item.id === sourceItem.id) {
                   return {
                       ...item,
                       contents: item.contents.map(c => ({
                           ...c,
                           amount: c.amount - (c.amount * pourFraction)
                       })).filter(c => c.amount > 0.0001),
                       liquidVolumeMl: Math.max(0, (item.liquidVolumeMl ?? sumLiquidVolumeMl(item.contents)) - transferredLiquidVolumeMl)
                   };
               }
               if (item.id === targetItem.id) {
                   const existingContents = [...item.contents];
                   for (const pc of pouredChemicals) {
                       const existingIndex = existingContents.findIndex(c => canonicalFormula(c.chemical?.formula) === canonicalFormula(pc.chemical?.formula));
                       if (existingIndex !== -1) {
                           existingContents[existingIndex] = { ...existingContents[existingIndex], amount: existingContents[existingIndex].amount + pc.amount };
                       } else {
                           existingContents.push(pc);
                       }
                   }
                   return {
                       ...item,
                       contents: mergeContentsByFormula(existingContents),
                       liquidVolumeMl: (item.liquidVolumeMl ?? sumLiquidVolumeMl(item.contents)) + transferredLiquidVolumeMl,
                       liquidColor: item.liquidColor === 'transparent' || item.contents.length === 0 ? sourceItem.liquidColor : item.liquidColor
                   };
               }
               return item;
           }));
           setSourceEquipmentId(null);
           return;
       }

       // Subtract from source
       setDeskItems(prev => prev.map(d => {
           if (d.id === sourceItem.id) {
               return {
                   ...d,
                   contents: d.contents.map(c => ({
                       ...c,
                       amount: c.amount - (c.amount * pourFraction)
                   })).filter(c => c.amount > 0.0001),
                   liquidVolumeMl: Math.max(0, (d.liquidVolumeMl ?? sumLiquidVolumeMl(d.contents)) - transferredLiquidVolumeMl)
               };
           }
           return d;
       }));

       setIsPouring(true);
       addLog(`Pouring ${actualPourAmount} units from ${sourceItem.equipment.name} into ${targetItem.equipment.name}...`);
       
       try {
          const data = await fetchReaction({ 
              sourceChemicals: pouredChemicals,
              targetEquipment: targetItem.equipment.name,
              targetChemicals: targetItem.contents,
              amount: actualPourAmount,
              sourceLiquidVolumeMl: transferredLiquidVolumeMl,
              targetLiquidVolumeMl: Number.isFinite(Number(targetItem.liquidVolumeMl))
                ? Number(targetItem.liquidVolumeMl)
                : sumLiquidVolumeMl(targetItem.contents),
              temperature: targetItem.temperature || 25,
              reactionTime: reactionTime,
              reactionRate: reactionRate,
              apiKeys: apiKeys
             });

          setDeskItems(prev => prev.map(item => {
            if (item.id === targetItem.id) {
              if (data.isExplosive) {
              audio.playExplosion();
              return { ...item, isExploded: true, visualEffect: data.visualEffect };
            }
            if (data.isPop) {
              audio.playPop();
            } else if (data.reactionOccurred) {
              audio.playMix(); setTimeout(() => audio.stopMix(), 3000);
            }
              const calculatedPourResults = data.reactionOccurred ? (data.resultingChemicals || []) : null;
              return {
                ...item,
                contents: calculatedPourResults
                  ? mergeContentsByFormula(calculatedPourResults
                      .filter((chemInfo: any) => {
                        const s = String(chemInfo?.state || '').toLowerCase();
                        if (s === 'gas' || s === 'g') return false;
                        if ((s === 'solid' || s === 's') && !(Number(chemInfo?.amount) > 0)) return false;
                        return true;
                      })
                      .map((chemInfo: any) => {
                      const normalizedState: 'solid' | 'liquid' | 'gas' = chemInfo.state === 'solid' ? 'solid' : chemInfo.state === 'gas' ? 'gas' : 'liquid';
                      const chem = { id: chemInfo.name.toLowerCase().replace(/\s+/g, '-'), name: chemInfo.name, formula: chemInfo.formula, defaultColor: chemInfo.defaultColor, category: chemInfo.category, state: normalizedState };
                      // reaction products are not added to the chemicals catalog
                      return {
                        chemical: chem,
                        amount: chemInfo.amount !== undefined ? chemInfo.amount : 0,
                        unit: resolveProductUnit(chemInfo, normalizedState),
                        moles: chemInfo.moles,
                        massG: chemInfo.massG,
                        volumeMl: chemInfo.volumeMl,
                        ...(chemInfo.concentration != null ? { concentration: chemInfo.concentration, molarity: chemInfo.concentration } : {}),
                        ...(chemInfo.molarity != null ? { molarity: chemInfo.molarity, concentration: chemInfo.molarity } : {})
                      };
                    }))
                  : (() => {
                      const newContents = [...item.contents];
                      for (const pouredChem of pouredChemicals) {
                          const existingIndex = newContents.findIndex(c => canonicalFormula(c.chemical?.formula) === canonicalFormula(pouredChem.chemical?.formula));
                          if (existingIndex !== -1) {
                              newContents[existingIndex] = { ...newContents[existingIndex], amount: newContents[existingIndex].amount + pouredChem.amount };
                          } else {
                              newContents.push(pouredChem);
                          }
                      }
                      return mergeContentsByFormula(newContents);
                    })(),
                liquidColor: data.liquidColor,
                visualEffect: data.visualEffect,
                gasProduced: data.gasProduced,
                gasColor: data.gasColor,
                temperature: (item.temperature || 25) + (data.temperatureChange || 0),
                hasPrecipitate: data.hasPrecipitate,
                precipitateColor: data.precipitateColor,
                equation: data.chemicalEquation,
                liquidVolumeMl: data.resultingLiquidVolumeMl ?? ((item.liquidVolumeMl ?? sumLiquidVolumeMl(item.contents)) + transferredLiquidVolumeMl)
              };
            }
            return item;
          }));
      addLog(`Result: ${data.chemicalEquation || 'Mixed without reaction'}`);
          if (data.visualEffect) addLog(`Visual: ${data.visualEffect}`);
          if (data.gasProduced) {
            const gasVol = data.gasVolumeMl;
            addLog(typeof gasVol === 'number'
              ? `Gas Produced (~${Math.round(gasVol)} mL at ${data.gasTemperatureC || 25}°C, ${data.gasPressureAtm || 1} atm — calculated from stoichiometry).`
              : `Gas Produced!`, false);
          }
          if (data.isExplosive) addLog(`EXPLOSION in ${targetItem.equipment.name}!`, true);
       } catch (err: any) {
          console.error(err);
          addLog(`Error: ${err.message || "Failed to simulate reaction"}`, true);
          // Rollback source item deduction on failure
          setDeskItems(prev => prev.map(d => d.id === sourceItem.id ? sourceItem : d));
       } finally {
          setIsPouring(false);
          setSourceEquipmentId(null);
       }
       return;
    }

    if (sourceEquipmentId === targetItem.id) {
       setSourceEquipmentId(null);
       return;
    }

    if (!selectedChemical) return;

    const currentTotalAmount = targetItem.contents.reduce((sum, c) => sum + c.amount, 0);
    if (currentTotalAmount + pourAmount > targetItem.equipment.capacity) {
      addLog(`Cannot add ${pourAmount} units. ${targetItem.equipment.name} overflows!`, true);
      return;
    }

    const skipAPI2 = targetItem.contents.length === 0 || (targetItem.contents.length === 1 && canonicalFormula(targetItem.contents[0]?.chemical?.formula) === canonicalFormula(selectedChemical?.formula));

    saveHistory();
    
    if (skipAPI2) {
      audio.playPour();
      addLog(`Added ${pourAmount}${selectedChemical.state === 'solid' ? 'g' : 'ml'} of ${selectedChemical.name} into ${targetItem.equipment.name}.`);
      setDeskItems(prev => prev.map(item => {
        if (item.id === targetItem.id) {
          const existingContents = [...item.contents];
                  existingContents.push({
                    chemical: selectedChemical,
                    amount: pourAmount,
                    unit: selectedChemical.state === 'solid' ? 'g' : 'ml',
                    ...(selectedChemical.concentration != null ? { concentration: selectedChemical.concentration, molarity: selectedChemical.concentration } : {}),
                    ...(selectedChemical.molarity != null ? { molarity: selectedChemical.molarity, concentration: selectedChemical.molarity } : {}),
                  });
          return {
             ...item,
             contents: mergeContentsByFormula(existingContents),
             liquidVolumeMl: (item.liquidVolumeMl ?? sumLiquidVolumeMl(item.contents)) + (selectedChemical.state === 'solid' ? 0 : pourAmount),
             liquidColor: item.contents.length === 0 ? selectedChemical.defaultColor : item.liquidColor
          };
        }
        return item;
      }));
      setSelectedChemical(null);
      return;
    }

    audio.playPour();
    setIsPouring(true);
    addLog(`Adding ${pourAmount}${selectedChemical.state === 'solid' ? 'g' : 'ml'} of ${selectedChemical.name} into ${targetItem.equipment.name}...`);
    
    try {
      const data = await fetchReaction({ 
          sourceChemicals: [{ chemical: selectedChemical, amount: pourAmount }],
          targetEquipment: targetItem.equipment.name,
          targetChemicals: targetItem.contents,
          amount: pourAmount,
          sourceLiquidVolumeMl: selectedChemical.state === 'solid' ? 0 : pourAmount,
          targetLiquidVolumeMl: Number.isFinite(Number(targetItem.liquidVolumeMl))
            ? Number(targetItem.liquidVolumeMl)
            : sumLiquidVolumeMl(targetItem.contents),
          temperature: targetItem.temperature || 25,
          reactionTime: reactionTime,
              reactionRate: reactionRate,
          apiKeys: apiKeys
         });

      setDeskItems(prev => prev.map(item => {
        if (item.id === targetItem.id) {
          if (data.isExplosive) {
              audio.playExplosion();
              return { ...item, isExploded: true, visualEffect: data.visualEffect };
            }
            if (data.isPop) {
              audio.playPop();
            } else if (data.reactionOccurred) {
              audio.playMix(); setTimeout(() => audio.stopMix(), 3000);
            }
          const calculatedAddResults = data.reactionOccurred ? (data.resultingChemicals || []) : null;
          return {
            ...item,
            contents: calculatedAddResults
              ? mergeContentsByFormula(calculatedAddResults
                  .filter((chemInfo: any) => {
                    const s = String(chemInfo?.state || '').toLowerCase();
                    if (s === 'gas' || s === 'g') return false;
                    if ((s === 'solid' || s === 's') && !(Number(chemInfo?.amount) > 0)) return false;
                    return true;
                  })
                  .map((chemInfo: any) => {
                      const normalizedState: 'solid' | 'liquid' | 'gas' = chemInfo.state === 'solid' ? 'solid' : chemInfo.state === 'gas' ? 'gas' : 'liquid';
                      const chem = { id: chemInfo.name.toLowerCase().replace(/\s+/g, '-'), name: chemInfo.name, formula: chemInfo.formula, defaultColor: chemInfo.defaultColor, category: chemInfo.category, state: normalizedState };
                      // reaction products are not added to the chemicals catalog
                      return {
                        chemical: chem,
                        amount: chemInfo.amount !== undefined ? chemInfo.amount : 0,
                        unit: resolveProductUnit(chemInfo, normalizedState),
                        moles: chemInfo.moles,
                        massG: chemInfo.massG,
                        volumeMl: chemInfo.volumeMl,
                        ...(chemInfo.concentration != null ? { concentration: chemInfo.concentration, molarity: chemInfo.concentration } : {}),
                        ...(chemInfo.molarity != null ? { molarity: chemInfo.molarity, concentration: chemInfo.molarity } : {})
                      };
                    }))
              : (() => {
                  const existingContents = [...item.contents];
                  existingContents.push({
                    chemical: selectedChemical,
                    amount: pourAmount,
                    unit: selectedChemical.state === 'solid' ? 'g' : 'ml',
                    ...(selectedChemical.concentration != null ? { concentration: selectedChemical.concentration, molarity: selectedChemical.concentration } : {}),
                    ...(selectedChemical.molarity != null ? { molarity: selectedChemical.molarity, concentration: selectedChemical.molarity } : {}),
                  });
                  return mergeContentsByFormula(existingContents);
                })(),
            liquidColor: data.liquidColor,
            visualEffect: data.visualEffect,
            gasProduced: data.gasProduced,
            gasColor: data.gasColor,
            temperature: (item.temperature || 25) + (data.temperatureChange || 0),
            hasPrecipitate: data.hasPrecipitate,
            precipitateColor: data.precipitateColor,
            equation: data.chemicalEquation,
            liquidVolumeMl: data.resultingLiquidVolumeMl ?? ((item.liquidVolumeMl ?? sumLiquidVolumeMl(item.contents)) + (selectedChemical.state === 'solid' ? 0 : pourAmount))
          };
        }
        return item;
      }));
      addLog(`Result: ${data.chemicalEquation || 'Mixed without reaction'}`);
      if (data.visualEffect) addLog(`Visual: ${data.visualEffect}`);
      if (data.gasProduced) {
        const gasVol = data.gasVolumeMl;
        addLog(gasVol != null
          ? `Gas Produced (~${gasVol} mL at ~25°C, 1 atm — estimated from reactant scale).`
          : `Gas Produced!`, false);
      }
      if (data.isExplosive) addLog(`EXPLOSION in ${targetItem.equipment.name}!`, true);
    } catch (err: any) {
      console.error(err);
      addLog(`Error: ${err.message || "Failed to simulate reaction"}`, true);
    } finally {
      setIsPouring(false);
      setSelectedChemical(null);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-800">
      
      {/* Left Sidebar - Equipment & Chemicals */}
      <div className={`bg-white border-r border-slate-200 flex flex-col z-10 shadow-lg transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-80' : 'w-16'} overflow-hidden shrink-0`}>
        {isSidebarOpen ? (
        <div className="w-80 flex-1 flex flex-col h-full opacity-100 transition-opacity duration-300">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-start whitespace-nowrap min-w-max">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2 text-indigo-700">
              <FlaskConical className="text-indigo-600" /> Virtual ChemLab
            </h1>
            <p className="text-sm text-slate-500 mt-1">Interactive 3D simulations powered by AI.</p>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-md transition-colors"
            title="Collapse Sidebar"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Equipments */}
          <div id="equipment-section" className="p-4 border-b border-slate-200">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Equipment Store</h2>
            </div>
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search equipment..." 
                value={equipmentSearch}
                onChange={e => setEquipmentSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
               <button onClick={() => setEquipmentSearch('')} className={`px-2 py-1 text-[10px] rounded-md transition-colors ${equipmentSearch === '' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>All</button>
               <button onClick={() => setEquipmentSearch('flask')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${equipmentSearch === 'flask' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><FlaskConical className="w-3 h-3"/> Flasks</button>
               <button onClick={() => setEquipmentSearch('meter')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${equipmentSearch === 'meter' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Thermometer className="w-3 h-3"/> Meters</button>
               <button onClick={() => setEquipmentSearch('burner')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${equipmentSearch === 'burner' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Flame className="w-3 h-3"/> Heat</button>
               <button onClick={() => setEquipmentSearch('tube')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${equipmentSearch === 'tube' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><TestTube className="w-3 h-3"/> Tubes</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(showAllEquipment ? EQUIPMENTS.filter(e => e.name.toLowerCase().includes(equipmentSearch.toLowerCase())) : EQUIPMENTS.filter(e => e.name.toLowerCase().includes(equipmentSearch.toLowerCase())).slice(0, 6)).map(equip => (
                <button
                  key={equip.id}
                  onClick={() => addEquipmentToDesk(equip)}
                  className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 transition-colors text-xs text-center group"
                >
                  <Beaker className="w-6 h-6 mb-1 text-slate-400 group-hover:text-indigo-500" />
                  <span className="truncate w-full">{equip.name}</span>
                  <span className="text-[10px] text-slate-400">{equip.capacity > 0 ? `${equip.capacity}ml` : 'Apparatus'}</span>
                </button>
              ))}
            </div>
            {EQUIPMENTS.filter(e => e.name.toLowerCase().includes(equipmentSearch.toLowerCase())).length > 6 && (
              <button 
                onClick={() => setShowAllEquipment(!showAllEquipment)}
                className="w-full mt-3 py-1.5 text-xs text-indigo-600 font-medium hover:bg-indigo-50 rounded-lg transition-colors"
              >
                {showAllEquipment ? 'Show Less' : 'Show More'}
              </button>
            )}
          </div>

          {/* Chemicals */}
          <div id="chemicals-section" className="p-4">
            <div className="flex justify-between items-center mb-3">
               <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Chemical Reagents</h2>
               <div className="flex items-center gap-2">
                 <span className="text-xs text-slate-500 font-medium">Pour:</span>
                 <input 
                   type="number" 
                   value={pourAmount}
                   onChange={e => setPourAmount(Math.max(1, parseInt(e.target.value) || 1))}
                   className="w-16 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500"
                   min="1"
                 />
                 <span className="text-xs text-slate-500 font-medium">{selectedChemical?.state === 'solid' ? 'g' : 'ml'}</span>
               </div>
            </div>
            
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search chemicals..." 
                value={chemicalSearch}
                onChange={e => setChemicalSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
               <button onClick={() => setChemicalSearch('')} className={`px-2 py-1 text-[10px] rounded-md transition-colors ${chemicalSearch === '' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>All</button>
               <button onClick={() => setChemicalSearch('acid')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${chemicalSearch === 'acid' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><FileWarning className="w-3 h-3"/> Acids</button>
               <button onClick={() => setChemicalSearch('base')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${chemicalSearch === 'base' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Droplet className="w-3 h-3"/> Bases</button>
               <button onClick={() => setChemicalSearch('indicator')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${chemicalSearch === 'indicator' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><FlaskRound className="w-3 h-3"/> Indicators</button>
               <button onClick={() => setChemicalSearch('solvent')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${chemicalSearch === 'solvent' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Beaker className="w-3 h-3"/> Solvents</button>
               <button onClick={() => setChemicalSearch('solid')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${chemicalSearch === 'solid' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Square className="w-3 h-3"/> Solids</button>
               <button onClick={() => setChemicalSearch('salt')} className={`px-2 py-1 text-[10px] rounded-md transition-colors flex items-center gap-1 ${chemicalSearch === 'salt' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Box className="w-3 h-3"/> Salts</button>
            </div>
            
            <div className="space-y-4">
              {(() => {
                const filteredChems = availableChemicals.filter(c => (c.name.toLowerCase().includes(chemicalSearch.toLowerCase()) || (c.category && c.category.toLowerCase().includes(chemicalSearch.toLowerCase())) || c.formula.toLowerCase().includes(chemicalSearch.toLowerCase())));
                const displayedChems = showAllChemicals ? filteredChems : filteredChems.slice(0, 8);
                const categories = Array.from(new Set(displayedChems.map(c => c.category))).sort();
                
                return (
                  <>
                    
                      {filteredChems.length === 0 && (
                        <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 flex flex-col items-center text-center mt-4">
                           <Sparkles className="w-8 h-8 text-indigo-400 mb-2" />
                           <h4 className="text-sm font-bold text-indigo-900 mb-1">Chemical Not Found</h4>
                           <p className="text-xs text-indigo-700/70 mb-4">Would you like to synthesize "{chemicalSearch}" using AI?</p>
                           <button
                              onClick={() => { setNewChemicalRequest(chemicalSearch); handleGenerateChemical(chemicalSearch); }}
                              disabled={isGeneratingChemical}
                              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300 transition-colors shadow-sm"
                           >
                              {isGeneratingChemical ? (
                                <><Activity className="w-4 h-4 animate-spin" /> Synthesizing...</>
                              ) : (
                                <><Plus className="w-4 h-4" /> Synthesize</>
                              )}
                           </button>
                        </div>
                      )}
{categories.map(category => {
                      const categoryChems = displayedChems.filter(c => c.category === category);
                      return (
                        <div key={category}>
                          <h3 className="text-xs font-bold text-slate-400 mb-2">{category}</h3>
                          <div className="space-y-2">
                            {categoryChems.map(chem => (
                              <button
                                key={chem.id}
                                onClick={() => {
                                  setSelectedChemical(selectedChemical?.id === chem.id ? null : chem);
                                  setActiveItemId(null);
                                }}
                                className={`w-full flex items-center p-3 rounded-xl border transition-all ${
                                  selectedChemical?.id === chem.id 
                                    ? 'bg-indigo-600 border-indigo-700 text-white shadow-md' 
                                    : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50 text-slate-700'
                                }`}
                              >
                                <div className="w-4 h-4 rounded-full border border-black/10 mr-3 shrink-0" style={{ backgroundColor: chem.defaultColor }} />
                                <div className="text-left flex-1 min-w-0">
                                  <div className="text-sm font-semibold truncate">{chem.name}</div>
                                  <div className={`text-xs truncate ${selectedChemical?.id === chem.id ? 'text-indigo-200' : 'text-slate-400'}`}>{chem.formula}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {filteredChems.length > 8 && (
                      <button 
                        onClick={() => setShowAllChemicals(!showAllChemicals)}
                        className="w-full mt-3 py-1.5 text-xs text-indigo-600 font-medium hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        {showAllChemicals ? 'Show Less' : 'Show More'}
                      </button>
                    )}
                  </>
                );
              })()}
            </div>



          </div>
        </div>
        </div>
        ) : (
           <div className="w-16 flex-1 flex flex-col items-center py-4 bg-slate-50 h-full shadow-inner overflow-y-auto">
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-indigo-600 hover:bg-indigo-100 rounded-lg mb-4 transition-colors shadow-sm bg-white border border-slate-200" title="Expand Sidebar">
                <Menu className="w-5 h-5" />
              </button>
              
              <div className="flex flex-col gap-2 w-full px-2">
                 <button onClick={() => { setIsSidebarOpen(true); setTimeout(() => document.getElementById('equipment-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 rounded-xl text-slate-500 hover:text-indigo-600 flex justify-center transition-all shadow-sm group relative" title="Equipment">
                   <Beaker className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setTimeout(() => document.getElementById('chemicals-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 rounded-xl text-slate-500 hover:text-indigo-600 flex justify-center transition-all shadow-sm group relative" title="Chemicals">
                   <TestTubes className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 
                 <div className="w-full h-px bg-slate-200 my-1"></div>
                 
                 <button onClick={() => { setIsSidebarOpen(true); setEquipmentSearch('flask'); setTimeout(() => document.getElementById('equipment-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 rounded-xl text-slate-500 hover:text-indigo-600 flex justify-center transition-all shadow-sm group relative" title="Flasks">
                   <FlaskConical className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setEquipmentSearch('meter'); setTimeout(() => document.getElementById('equipment-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-orange-50 hover:border-orange-200 rounded-xl text-slate-500 hover:text-orange-600 flex justify-center transition-all shadow-sm group relative" title="Meters">
                   <Thermometer className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setEquipmentSearch('tube'); setTimeout(() => document.getElementById('equipment-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 rounded-xl text-slate-500 hover:text-indigo-600 flex justify-center transition-all shadow-sm group relative" title="Tubes">
                   <TestTube className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setEquipmentSearch('burner'); setTimeout(() => document.getElementById('equipment-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-red-50 hover:border-red-200 rounded-xl text-slate-500 hover:text-red-600 flex justify-center transition-all shadow-sm group relative" title="Heating">
                   <Flame className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 
                 <div className="w-full h-px bg-slate-200 my-1"></div>

                 <button onClick={() => { setIsSidebarOpen(true); setChemicalSearch('acid'); setTimeout(() => document.getElementById('chemicals-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-red-50 hover:border-red-200 rounded-xl text-slate-500 hover:text-red-600 flex justify-center transition-all shadow-sm group relative" title="Acids">
                   <FileWarning className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setChemicalSearch('base'); setTimeout(() => document.getElementById('chemicals-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 rounded-xl text-slate-500 hover:text-blue-600 flex justify-center transition-all shadow-sm group relative" title="Bases">
                   <Droplet className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setChemicalSearch('indicator'); setTimeout(() => document.getElementById('chemicals-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-purple-50 hover:border-purple-200 rounded-xl text-slate-500 hover:text-purple-600 flex justify-center transition-all shadow-sm group relative" title="Indicators">
                   <FlaskRound className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setChemicalSearch('solvent'); setTimeout(() => document.getElementById('chemicals-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-cyan-50 hover:border-cyan-200 rounded-xl text-slate-500 hover:text-cyan-600 flex justify-center transition-all shadow-sm group relative" title="Solvents">
                   <Beaker className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setChemicalSearch('salt'); setTimeout(() => document.getElementById('chemicals-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 rounded-xl text-slate-500 hover:text-emerald-600 flex justify-center transition-all shadow-sm group relative" title="Salts">
                   <Box className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
                 <button onClick={() => { setIsSidebarOpen(true); setChemicalSearch('other'); setTimeout(() => document.getElementById('chemicals-section')?.scrollIntoView({behavior:'smooth'}), 300); }} className="p-2.5 bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 rounded-xl text-slate-500 hover:text-slate-700 flex justify-center transition-all shadow-sm group relative" title="Other Reagents">
                   <Activity className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 </button>
              </div>
           </div>
        )}
      </div>
      {/* Main 3D/2D Viewport */}
      <div className="flex-1 relative h-full w-full">
        <Suspense fallback={<div className="h-full w-full bg-slate-100" aria-hidden="true" />}>
        {viewMode === '3D' ? (
          <LabScene 
            deskItems={deskItems} 
            onEquipmentClick={handleEquipmentClick} 
            onEquipmentMove={handleEquipmentMove}
            activeItemId={activeItemId}
            setActiveItemId={setActiveItemId}
            transformMode={transformMode}
          />
        ) : (
          <LabScene2D 
            deskItems={deskItems} 
            onEquipmentClick={handleEquipmentClick} 
            onEquipmentMove={handleEquipmentMove}
            activeItemId={activeItemId}
            setActiveItemId={setActiveItemId}
            transformMode={transformMode}
          />
        )}
        </Suspense>
        
        {/* Overlay UI */}
        <div className="absolute top-4 left-4 right-4 pointer-events-none flex justify-between items-start">
          
          {/* Reaction Log */}
          <div className={`w-80 bg-white/90 backdrop-blur-md rounded-2xl border border-white/50 shadow-xl pointer-events-auto flex flex-col overflow-hidden transition-all duration-300 ${isNotesMinimized ? 'h-12' : 'max-h-[400px]'}`}>
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center cursor-pointer" onClick={() => setIsNotesMinimized(!isNotesMinimized)}>
              <h3 className="font-bold text-sm flex items-center gap-2 text-slate-700">
                <AlertCircle className="w-4 h-4 text-indigo-500" /> Lab Notes
              </h3>
              <div className="flex items-center gap-3">
                {!isNotesMinimized && logs.length > 0 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setLogs([]); }}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                    title="Clear Notes"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button className="text-slate-400 hover:text-slate-600">
                  {isNotesMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <div className={`flex-1 flex flex-col ${isNotesMinimized ? 'hidden' : 'block'}`}>
              <div className="overflow-y-auto max-h-40 p-4 space-y-2 border-b border-slate-100">
              <AnimatePresence>
                {logs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`text-xs p-2 rounded-lg border ${
                      log.isError 
                        ? 'bg-red-50 border-red-100 text-red-700' 
                        : 'bg-slate-100/50 border-slate-200 text-slate-700'
                    }`}
                  >
                    {log.msg}
                  </motion.div>
                ))}
                {logs.length === 0 && (
                  <div className="text-xs text-slate-400 italic text-center mt-4">No reaction logs.</div>
                )}
              </AnimatePresence>
              </div>
              <div className="flex-1 p-3 flex flex-col h-40">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-slate-500">Personal Notes</span>
                  <button onClick={() => setIsEditingNotes(!isEditingNotes)} className="text-xs text-indigo-500 hover:text-indigo-700">
                    {isEditingNotes ? 'Preview' : 'Edit'}
                  </button>
                </div>
                {isEditingNotes ? (
                  <textarea 
                    className="w-full h-full p-2 text-xs bg-slate-50 border border-slate-200 rounded resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    value={userNotes}
                    onChange={handleNotesChange}
                    placeholder="Type notes in Markdown..."
                  />
                ) : (
                  <div className="w-full h-full p-2 text-xs text-slate-700 bg-white border border-transparent overflow-y-auto prose prose-sm prose-indigo">
                    {userNotes ? <Markdown>{userNotes}</Markdown> : <span className="text-slate-400 italic">No notes. Click edit to start.</span>}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 items-end">
            {/* Active Tool Tip */}
            <AnimatePresence>
              {(selectedChemical || sourceEquipmentId) && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-full shadow-lg font-medium text-sm flex items-center gap-3 pointer-events-auto"
                >
                  <Droplet className="w-4 h-4 animate-bounce" />
                  {sourceEquipmentId 
                     ? `Ready to pour from ${deskItems.find(d => d.id === sourceEquipmentId)?.equipment.name}. Click target equipment.`
                     : `Ready to add ${pourAmount}${selectedChemical?.state === 'solid' ? 'g' : 'ml'} of ${selectedChemical?.name}. Click equipment on desk.`
                  }
                  {sourceEquipmentId && (
                    <span className="flex items-center gap-1 bg-indigo-700/60 rounded-full pl-2 pr-1 py-0.5">
                      <span className="text-xs text-indigo-100 font-medium">Amount:</span>
                      <input
                        type="number"
                        value={beakerPourAmount}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setBeakerPourAmount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 px-1.5 py-0.5 text-xs text-slate-800 border border-indigo-300 rounded focus:outline-none focus:border-white"
                        min="1"
                      />
                      <span className="text-xs text-indigo-100 font-medium pr-1">ml</span>
                    </span>
                  )}
                  <button onClick={() => { setSelectedChemical(null); setSourceEquipmentId(null); }} className="ml-2 hover:bg-indigo-700 p-1 rounded-full text-indigo-200 hover:text-white transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* Transform Controls Toolbar */}
            <AnimatePresence>
              {activeItemId && !selectedChemical && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white px-3 py-2 rounded-xl shadow-lg border border-slate-200 font-medium text-sm flex items-center gap-2 pointer-events-auto"
                >
                  {(deskItems.find(i => i.id === activeItemId)?.equipment.capacity || 0) > 0 && (
                  <button 
                    onClick={() => {
                      if (sourceEquipmentId === activeItemId) setSourceEquipmentId(null);
                      else setSourceEquipmentId(activeItemId);
                    }}
                    className={`p-2 rounded-lg transition-colors ${sourceEquipmentId === activeItemId ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
                    title="Pour from this"
                  >
                    <Droplet className="w-4 h-4" />
                  </button>
                  )}
                  {deskItems.find(i => i.id === activeItemId)?.equipment.shape.match(/heater|burner|stirrer|sunlight|electrodes|cooler/) && (
                    <button 
                      onClick={() => {
                        const activeItem = deskItems.find(i => i.id === activeItemId);
                        const willBeOn = !activeItem?.isOn;
                        setDeskItems(prev => prev.map(item => 
                          item.id === activeItemId 
                            ? { ...item, isOn: willBeOn } 
                            : item
                        ));
                        if (willBeOn) {
                           if (activeItem?.equipment.interactionRole === 'burner' || activeItem?.equipment.interactionRole === 'candle' || activeItem?.equipment.shape === 'heater') {
                               audio.playIgnite();
                               audio.playBurn();
                           } else if (activeItem?.equipment.shape === 'stirrer') {
                               audio.playMix();
                           }
                           let actionType: 'heat' | 'stir' | 'photolyze' | 'electrolyze' | 'cool' = 'heat';
                           if (activeItem?.equipment.shape === 'stirrer') actionType = 'stir';
                           else if (activeItem?.equipment.shape === 'sunlight') actionType = 'photolyze';
                           else if (activeItem?.equipment.shape === 'electrodes') actionType = 'electrolyze';
                           else if (activeItem?.equipment.shape === 'cooler') actionType = 'cool';
                           handleProcess(actionType, activeItemId);
                        } else {
                           if (activeItem?.equipment.interactionRole === 'burner' || activeItem?.equipment.interactionRole === 'candle' || activeItem?.equipment.shape === 'heater') {
                               audio.stopBurn();
                           } else if (activeItem?.equipment.shape === 'stirrer') {
                               audio.stopMix();
                           }
                        }
                      }}
                      className={`p-2 rounded-lg transition-colors ${deskItems.find(i => i.id === activeItemId)?.isOn ? 'bg-orange-100 text-orange-600' : 'text-slate-500 hover:bg-slate-100'}`}
                      title="Toggle Power"
                    >
                      {(deskItems.find(i => i.id === activeItemId)?.equipment.interactionRole === 'burner' || deskItems.find(i => i.id === activeItemId)?.equipment.interactionRole === 'candle') ? <Flame className="w-4 h-4" /> : deskItems.find(i => i.id === activeItemId)?.equipment.shape === 'cooler' ? <span className="text-sm">❄️</span> : <Power className="w-4 h-4" />}
                    </button>
                  )}
                  {deskItems.find(i => i.id === activeItemId)?.equipment.shape === 'balance' && (
                    <button 
                      onClick={() => {
                        setDeskItems(prev => prev.map(item => 
                          item.id === activeItemId 
                            ? (() => {
                              const otherItems = prev.filter(x => x.id !== item.id);
                              let closest = null, minDist = 3.0;
                              for(const other of otherItems) {
                                const dist = Math.hypot(other.position[0]-item.position[0], other.position[2]-item.position[2]);
                                if (dist < minDist) { minDist = dist; closest = other; }
                              }
                              const w = closest ? (closest.contents.reduce((s, c) => s + c.amount, 0) + closest.equipment.capacity * 0.1) : 0;
                              return { ...item, reading: w };
                            })() 
                            : item
                        ));
                      }}
                      className={`p-2 rounded-lg transition-colors text-slate-500 hover:bg-slate-100`}
                      title="Tare (Zero)"
                    >
                      <Scale className="w-4 h-4" />
                    </button>
                  )}
                  <div className="w-px h-6 bg-slate-200 mx-1" />
                  <button 
                    onClick={() => {
                      saveHistory();
                      setDeskItems(deskItems.filter(i => i.id !== activeItemId));
                      setActiveItemId(null);
                      setSourceEquipmentId(null);
                    }}
                    className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete Item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            
            
            
            {/* View Mode Toggle */}
            {uiMode === 'floating' && (
              <button 
                onClick={() => setViewMode(viewMode === '3D' ? '2D' : '3D')}
                className="bg-white px-4 py-2 rounded-xl shadow-lg border border-slate-200 font-medium text-sm flex items-center gap-2 hover:bg-slate-50 transition-colors pointer-events-auto mt-2"
              >
                {viewMode === '3D' ? <Layers className="w-4 h-4 text-indigo-600" /> : <Box className="w-4 h-4 text-indigo-600" />}
                Switch to {viewMode === '3D' ? '2D View' : '3D View'}
              </button>
            )}
            
            {/* Reaction Rate Selector */}
            {uiMode === 'floating' && (
              <div className="bg-white px-4 py-2 rounded-xl shadow-lg border border-slate-200 font-medium text-sm flex items-center gap-2 pointer-events-auto mt-2">
                <span className="text-slate-600 flex items-center gap-1"><Zap className="w-4 h-4"/> Reaction Rate:</span>
                <select 
                  value={reactionRate} 
                  onChange={e => setReactionRate(e.target.value as 'slow' | 'normal' | 'fast')}
                  className="bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700"
                >
                  <option value="slow">Slow</option>
                  <option value="normal">Normal</option>
                  <option value="fast">Fast</option>
                </select>
              </div>
            )}
            {/* Reaction Time Selector */}
            <div className="bg-white px-4 py-2 rounded-xl shadow-lg border border-slate-200 font-medium text-sm flex items-center gap-2 pointer-events-auto mt-2">
              <span className="text-slate-600 flex items-center gap-1"><Activity className="w-4 h-4"/> Simulation Time:</span>
              <select 
                value={reactionTime} 
                onChange={e => setReactionTime(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700"
              >
                <option value="1s">1 second</option>
                <option value="5s">5 seconds</option>
                <option value="10s">10 seconds</option>
                <option value="30s">30 seconds</option>
                <option value="1m">1 minute</option>
                <option value="end">End of reaction</option>
              </select>
            </div>

          </div>
        </div>

        {/* Loading overlay for pouring */}
        {isPouring && (
           <div className="absolute inset-0 bg-black/10 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-auto">
             <div className="bg-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3">
               <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
               <span className="font-semibold text-indigo-900">{loadingText}</span>
             </div>
           </div>
        )}

        {/* Selected Equipment Info Panel */}
        <AnimatePresence>
          {activeItemId && deskItems.find(i => i.id === activeItemId) && (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="absolute bottom-6 left-6 bg-white/90 backdrop-blur-md rounded-2xl border border-white/50 shadow-xl pointer-events-auto w-64 overflow-hidden z-20"
            >
              <div className="p-3 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                <h3 className="font-bold text-sm text-indigo-900 flex items-center gap-2">
                  <Box className="w-4 h-4 text-indigo-500" />
                  {deskItems.find(i => i.id === activeItemId)?.equipment.name}
                </h3>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Temperature</span>
                  <span className="font-medium text-slate-800">{deskItems.find(i => i.id === activeItemId)?.temperature?.toFixed(1) || 25}°C</span>
                </div>
                {(deskItems.find(i => i.id === activeItemId)?.equipment.capacity || 0) > 0 && (
                  <>
                    
                    <div className="space-y-1">
                      <span className="text-slate-500">Contents</span>
                      <div className="bg-slate-50 rounded-lg p-2 border border-slate-100 max-h-32 overflow-y-auto">
                        {deskItems.find(i => i.id === activeItemId)?.contents.length === 0 ? (
                          <p className="text-slate-400 text-xs text-center py-2">Empty</p>
                        ) : (
                          deskItems.find(i => i.id === activeItemId)?.contents.map((c, idx) => (
                            <div key={idx} className="flex justify-between items-center py-1 border-b border-slate-100 last:border-0 text-xs">
                              <span className="truncate flex-1 pr-2 text-slate-700">{c.chemical.name}</span>
                              <span className="font-semibold text-slate-600">{formatQuantity(c)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Precipitate</span>
                      <span className="font-medium text-slate-800 flex items-center gap-2">
                        {deskItems.find(i => i.id === activeItemId)?.hasPrecipitate ? (
                          <>
                            <div className="w-3 h-3 rounded-full border border-slate-300" style={{ backgroundColor: deskItems.find(i => i.id === activeItemId)?.precipitateColor || '#fff' }}></div>
                            Yes
                          </>
                        ) : 'None'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Fill Level</span>
                      <span className="font-medium text-slate-800">
                        {(() => {
                          const vol = Number(deskItems.find(i => i.id === activeItemId)?.liquidVolumeMl ?? sumLiquidVolumeMl(deskItems.find(i => i.id === activeItemId)?.contents)) || 0;
                          const shown = Math.abs(vol - Math.round(vol)) < 1e-6 ? String(Math.round(vol)) : vol.toFixed(1);
                          return `${shown} / ${deskItems.find(i => i.id === activeItemId)?.equipment.capacity} mL`;
                        })()}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        
        {/* Floating Actions Bottom Right */}
        {uiMode === 'floating' && (
          <div className={`absolute bottom-6 right-6 flex flex-col gap-2 pointer-events-auto transition-all duration-300 ${isSettingsOpen ? 'blur-sm pointer-events-none opacity-50' : ''}`}>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl shadow-lg border border-slate-200 font-medium text-sm transition-colors flex items-center gap-2"
            >
              <Settings className="w-4 h-4" /> Settings
            </button>
            <button 
              onClick={handleUndo}
              disabled={history.length === 0}
              className={`bg-white px-4 py-2 rounded-xl shadow-lg border border-slate-200 font-medium text-sm transition-colors flex items-center gap-2 ${history.length === 0 ? 'opacity-50 text-slate-400 cursor-not-allowed' : 'hover:bg-slate-50 text-slate-700'}`}
            >
              <Undo2 className="w-4 h-4" /> Undo
            </button>
            {deskItems.length > 0 && (
              <button 
                onClick={() => { saveHistory(); audio.stopAll(); setDeskItems([]); setActiveItemId(null); setSourceEquipmentId(null); }}
                className="bg-white hover:bg-red-50 text-red-600 px-4 py-2 rounded-xl shadow-lg border border-red-100 font-medium text-sm transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Clear Desk
              </button>
            )}
          </div>
        )}

        
        {uiMode === 'bar' && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/90 backdrop-blur-md px-4 py-2 rounded-2xl shadow-xl border border-white/50 pointer-events-auto z-40">
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-2"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm font-medium">Settings</span>
            </button>
            <div className="w-px h-6 bg-slate-200" />
            <button 
              onClick={handleUndo}
              disabled={history.length === 0}
              className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${history.length === 0 ? 'text-slate-400 opacity-50 cursor-not-allowed' : 'text-slate-600 hover:text-indigo-600 hover:bg-indigo-50'}`}
              title="Undo"
            >
              <Undo2 className="w-5 h-5" />
              <span className="text-sm font-medium">Undo</span>
            </button>
            <div className="w-px h-6 bg-slate-200" />
            <button 
              onClick={() => setViewMode(viewMode === '3D' ? '2D' : '3D')}
              className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-2"
              title={`Switch to ${viewMode === '3D' ? '2D View' : '3D View'}`}
            >
              {viewMode === '3D' ? <Layers className="w-5 h-5" /> : <Box className="w-5 h-5" />}
              <span className="text-sm font-medium">{viewMode === '3D' ? '2D' : '3D'} Mode</span>
            </button>
            <div className="w-px h-6 bg-slate-200" />
            
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-slate-400"/>
              <select 
                value={reactionRate} 
                onChange={e => setReactionRate(e.target.value as 'slow' | 'normal' | 'fast')}
                className="bg-transparent text-sm font-medium text-slate-600 outline-none cursor-pointer"
              >
                <option value="slow">Slow</option>
                <option value="normal">Normal Rate</option>
                <option value="fast">Fast</option>
              </select>
            </div>
            
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-400"/>
              <select 
                value={reactionTime} 
                onChange={e => setReactionTime(e.target.value)}
                className="bg-transparent text-sm font-medium text-slate-600 outline-none cursor-pointer"
              >
                <option value="0.1">0.1s Time</option>
                <option value="1">1s Time</option>
                <option value="10">10s Skip</option>
                <option value="60">1m Skip</option>
              </select>
            </div>

            {deskItems.length > 0 && (
              <>
                <div className="w-px h-6 bg-slate-200" />
                <button 
                  onClick={() => { saveHistory(); audio.stopAll(); setDeskItems([]); setActiveItemId(null); setSourceEquipmentId(null); }}
                  className="p-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
                  title="Clear Desk"
                >
                  <Trash2 className="w-5 h-5" />
                  <span className="text-sm font-medium">Clear</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Settings Modal */}
        <AnimatePresence>
          {isSettingsOpen && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center pointer-events-auto">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              >
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <h2 className="font-bold text-slate-800 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-indigo-500" /> Lab Settings
                  </h2>
                  <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">UI Layout Mode</label>
                    <div className="flex gap-2">
                      <button onClick={() => setUiMode('floating')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${uiMode === 'floating' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Floating Controls</button>
                      <button onClick={() => setUiMode('bar')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${uiMode === 'bar' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Bottom Taskbar</button>
                    </div>
                  </div>
                  <div className="w-full h-px bg-slate-100" />
                  <p className="text-sm text-slate-600">
                    Add your own Gemini API key to run reactions. This app does not ship with a built-in key - you must provide at least one.
                  </p>
                  
                  <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-indigo-800 leading-relaxed">
                      You can get a free API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">Google AI Studio</a>.
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    {apiKeys.map((key, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
                        <code className="text-xs text-slate-600 truncate flex-1">{key.substring(0, 10)}...</code>
                        <button 
                          onClick={() => saveApiKeys(apiKeys.filter((_, i) => i !== idx))}
                          className="text-red-500 hover:bg-red-50 p-1 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newApiKey}
                      onChange={(e) => setNewApiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                    <button 
                      onClick={() => {
                        if (newApiKey.trim()) {
                          saveApiKeys([...apiKeys, newApiKey.trim()]);
                          setNewApiKey('');
                        }
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
