/**
 * Deterministic stoichiometric product quantities.
 *
 * Inputs (desk units):
 *   - solid  → amount in grams
 *   - liquid / aqueous → amount in mL (assumed 1.00 mol/L when concentration unknown)
 *   - gas in vessel → amount in mL, converted via PV=nRT
 *
 * Outputs (what the student sees):
 *   - solid products → grams
 *   - aqueous / solution products → mL of solution (conserved liquid volume from inputs)
 *     plus massG / moles of solute for accuracy
 *   - pure liquid products → mL when density known, else grams
 *   - gases → NOT in resultingChemicals; reported as gasVolumeMl via PV=nRT
 *
 * Atmospheric O2 / N2 / Ar are treated as unlimited (open-air combustion).
 */

import {
  productPhysicalQuantity,
  normalizeChemicalState,
  sumLiquidVolumeMl,
  isAqueousState,
  roundQuantity,
  getDensityGPerMl,
} from './quantityDisplay';
import { cleanFormula, parseBalancedEquation } from './reactionProfile';

/** Canonical formula identity (Unicode subscripts → ASCII, phase labels stripped). */
export function canonicalFormula(formula: string | undefined): string {
  return cleanFormula(formula || '');
}

const DEFAULT_AQUEOUS_MOLARITY = 1.0;
const ROOM_TEMPERATURE_K = 298.15;
const R_L_ATM = 0.082057;

const UNLIMITED_AIR_REACTANTS = new Set(['o2', 'n2', 'ar']);

const GAS_FORMULA_HINTS = new Set([
  'h2', 'o2', 'n2', 'cl2', 'co2', 'co', 'so2', 'nh3', 'ch4', 'c2h6', 'c3h8', 'c4h10',
  'c2h2', 'c2h4', 'n2o', 'no', 'no2', 'h2s', 'o3', 'ar', 'he', 'ne',
]);

const ATOMIC_MASS: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011,
  N: 14.007, O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305,
  Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
  K: 39.098, Ca: 40.078, Fe: 55.845, Cu: 63.546, Zn: 65.38, Br: 79.904,
  Ag: 107.868, I: 126.904, Ba: 137.327, Pb: 207.2, Mn: 54.938, Cr: 51.996,
};

/**
 * Molar mass from a chemical formula. Accepts either CamelCase (HCl) or
 * lowercased (hcl) forms by matching elements case-insensitively.
 */
export function formulaMolarMass(formula: string): number | null {
  let f = String(formula || '')
    .replace(/\s+/g, '')
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch)))
    .replace(/₂/g, '2')
    .replace(/₃/g, '3')
    .replace(/₄/g, '4')
    .replace(/\((aq|l|s|g)\)$/i, '')
    .replace(/[⁺⁻+\-]\d*$/u, '')
    .replace(/\^\d*[+-]$/, '');
  if (!f) return null;

  // Known symbols sorted by length so "Na" wins over "N".
  const SYMBOLS = Object.keys(ATOMIC_MASS).sort((a, b) => b.length - a.length);

  const parsePart = (s: string): number | null => {
    let i = 0;
    const lower = s; // we match case-insensitively
    let mass = 0;
    const stack: number[] = [];

    while (i < lower.length) {
      const ch = lower[i];
      if (ch === '(') {
        stack.push(mass);
        mass = 0;
        i++;
        continue;
      }
      if (ch === ')') {
        i++;
        let num = '';
        while (i < lower.length && lower[i] >= '0' && lower[i] <= '9') num += lower[i++];
        const mult = num ? Number(num) : 1;
        mass = (stack.pop() ?? 0) + mass * mult;
        continue;
      }
      if (ch === '·' || ch === '.' || ch === '-') {
        i++;
        continue;
      }
      if (ch >= '0' && ch <= '9') {
        // Bare leading coefficient for hydrate segments handled outside.
        return null;
      }
      // Match element symbol
      let matched: string | null = null;
      const rest = lower.slice(i);
      for (const sym of SYMBOLS) {
        if (rest.toLowerCase().startsWith(sym.toLowerCase())) {
          // Ensure we don't match "C" of "Cl" incorrectly — longest first already.
          matched = sym;
          break;
        }
      }
      if (!matched) return null;
      i += matched.length;
      let num = '';
      while (i < lower.length && lower[i] >= '0' && lower[i] <= '9') num += lower[i++];
      mass += ATOMIC_MASS[matched] * (num ? Number(num) : 1);
    }
    if (stack.length) return null;
    return mass;
  };

  // Hydrates: CuSO4·5H2O
  const hydrateParts = f.split(/[·.]/);
  let total = 0;
  for (const part of hydrateParts) {
    const m = part.match(/^(\d+)([A-Za-z(].*)$/);
    if (m) {
      const n = Number(m[1]);
      const sub = parsePart(m[2]);
      if (sub == null) return null;
      total += n * sub;
    } else {
      const sub = parsePart(part);
      if (sub == null) return null;
      total += sub;
    }
  }
  return total > 0 ? total : null;
}

function formulaMatches(a: string, b: string): boolean {
  return cleanFormula(a) === cleanFormula(b);
}

/**
 * Resolve concentration (mol/L) for an aqueous input.
 * Hierarchy: explicit concentration/molarity on content or chemical → 1.00 M default.
 * Applied exactly once (never multiply volume by concentration twice).
 */
function resolveAqueousMolarity(entry: { chemical?: any; concentration?: number; molarity?: number }): number {
  const candidates = [
    entry?.concentration,
    entry?.molarity,
    entry?.chemical?.concentration,
    entry?.chemical?.molarity,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_AQUEOUS_MOLARITY;
}

/**
 * True when this input should be treated as a pure liquid (density → moles),
 * not as an aqueous solution (volume × molarity).
 */
function isPureLiquidInput(state: string, chemical: any, formula: string): boolean {
  if (isAqueousState(state)) return false;
  const cat = String(chemical?.category || '').toLowerCase();
  if (cat.includes('solvent')) return true;
  // Acids / bases / salt solutions in this catalog are aqueous reagents.
  if (cat.includes('acid') || cat.includes('base') || cat.includes('salt')) return false;
  const s = String(state || '').toLowerCase();
  if ((s === 'liquid' || s === 'l') && getDensityGPerMl(formula)) return true;
  return false;
}

function inputMoles(
  amount: number,
  state: string,
  formula: string,
  pressureAtm: number,
  entry?: {
    chemical?: any;
    concentration?: number;
    molarity?: number;
    moles?: number;
    unit?: string;
    massG?: number;
    volumeMl?: number;
  },
  temperatureC = 25
): number | null {
  const suppliedMoles = Number(entry?.moles);
  if (Number.isFinite(suppliedMoles) && suppliedMoles >= 0) {
    // Reaction-generated contents carry authoritative stoichiometric moles.
    // Use them instead of interpreting a solute's display grams as mL.
    return suppliedMoles;
  }

  const mw = formulaMolarMass(formula);
  if (!mw) return null;
  const s = String(state || 'liquid').toLowerCase();
  if (s === 'solid' || s === 's') return amount / mw;
  if (s === 'gas' || s === 'g') {
    // amount in mL → L, n = PV/RT
    const temperatureK = (Number.isFinite(temperatureC) ? temperatureC : 25) + 273.15;
    return ((amount / 1000) * pressureAtm) / (R_L_ATM * temperatureK);
  }
  // Pure liquid: volume (mL) → mass via density → moles
  if (isPureLiquidInput(s, entry?.chemical, formula)) {
    const density = getDensityGPerMl(formula);
    if (density && density > 0) {
      return (amount * density) / mw;
    }
  }
  // Aqueous / unspecified solution: moles = V(L) × concentration (default 1.00 M)
  const molarity = resolveAqueousMolarity(entry || {});
  return (amount / 1000) * molarity;
}

export type StoichiometryResult = {
  resultingChemicals: any[];
  resultingLiquidVolumeMl: number;
  gasProduced: boolean;
  gasVolumeMl: number;
  gasTemperatureC: number;
  gasPressureAtm: number;
  reactionExtentMoles: number;
  quantityCalculation: Record<string, any>;
};

/**
 * Compute product quantities from a balanced equation and the chemicals on the desk.
 * Returns null when the equation cannot be applied (missing reactant, bad MW, etc.).
 */
export function calculateDeterministicQuantities(
  equation: string,
  inputChemicals: any[],
  aiResults: any[],
  temperatureC: number,
  pressureAtm: number,
  inputLiquidVolumeMl?: number
): StoichiometryResult | null {
  const parsed = parseBalancedEquation(equation);
  if (!parsed) return null;

  // Aggregate desk contents by canonical formula, but aggregate PHYSICAL
  // quantities rather than displayed amounts. Two identical formulas may have
  // different concentrations, so summing their mL and retaining the first
  // concentration would be mathematically wrong.
  type InputPool = {
    formula: string;
    state: string;
    chemical: any;
    entries: any[];
    moles: number;
    volumeMl: number;
    massG: number;
  };
  const inputByFormula = new Map<string, InputPool>();

  for (const c of inputChemicals || []) {
    const formula = canonicalFormula(c?.chemical?.formula || c?.formula || '');
    if (!formula) continue;

    const amount = Number(c?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const state = String(c?.chemical?.state || c?.state || 'liquid').toLowerCase();
    const chemical = c?.chemical || c;
    const mw = formulaMolarMass(formula);
    const moles = inputMoles(
      amount,
      state,
      formula,
      pressureAtm,
      {
        chemical,
        concentration: c?.concentration,
        molarity: c?.molarity,
        moles: c?.moles,
        unit: c?.unit,
        massG: c?.massG,
        volumeMl: c?.volumeMl,
      },
      temperatureC
    );

    if (moles == null || !Number.isFinite(moles) || moles < 0) continue;

    const isSolid = state === 'solid' || state === 's';
    const isGas = state === 'gas' || state === 'g';
    const volumeMl =
      isSolid
        ? 0
        : Number.isFinite(Number(c?.volumeMl))
          ? Math.max(0, Number(c.volumeMl))
          : Math.max(0, amount);

    const massG = mw != null
      ? moles * mw
      : (isSolid ? amount : 0);

    const previous = inputByFormula.get(formula);
    if (previous) {
      previous.entries.push(c);
      previous.moles += moles;
      previous.volumeMl += volumeMl;
      previous.massG += massG;
      // Prefer metadata from the first entry, but physical quantities are
      // always aggregated independently above.
    } else {
      inputByFormula.set(formula, {
        formula,
        state,
        chemical,
        entries: [c],
        moles,
        volumeMl,
        massG,
      });
    }
  }

  // Moles of each reactant that is present (air species may be absent → unlimited).
  const reactantMoles = new Map<string, number>();
  const limitingReactants: { formula: string; coefficient: number }[] = [];
  const reactantKeys = new Set<string>();

  for (const r of parsed.reactants) {
    const key = canonicalFormula(r.formula);
    const entry = inputByFormula.get(key);

    if (!entry && UNLIMITED_AIR_REACTANTS.has(key)) {
      continue; // open air
    }
    if (!entry) return null;

    // The pool already contains moles calculated independently for every
    // physical input entry, so mixed concentrations are handled correctly.
    const moles = entry.moles;
    if (!Number.isFinite(moles)) return null;
    reactantMoles.set(key, moles);
    reactantKeys.add(key);
    limitingReactants.push({ formula: r.formula, coefficient: r.coefficient });
  }

  if (!limitingReactants.length) return null;

  const extents = limitingReactants.map(r => {
    const n = reactantMoles.get(cleanFormula(r.formula))!;
    return n / r.coefficient;
  });
  const reactionExtent = Math.min(...extents);
  if (!Number.isFinite(reactionExtent) || reactionExtent < 0) return null;

  // Track the actual shared liquid volume at the container level. App callers
  // provide this explicitly because aqueous products are stored as solute grams
  // and therefore cannot reconstruct solution volume from content.amount.
  let resultingLiquidVolumeMl =
    Number.isFinite(Number(inputLiquidVolumeMl))
      ? Math.max(0, Number(inputLiquidVolumeMl))
      : sumLiquidVolumeMl(inputChemicals);

  // Pure-liquid reactants lose physical volume as they are consumed. Aqueous
  // solution volume is treated as conserved solvent volume for the simulator.
  for (const r of parsed.reactants) {
    const key = canonicalFormula(r.formula);
    const entry = inputByFormula.get(key);
    if (!entry) continue;
    if (isPureLiquidInput(entry.state, entry.chemical, r.formula)) {
      const density = getDensityGPerMl(r.formula);
      const mw = formulaMolarMass(r.formula);
      if (density && density > 0 && mw) {
        const consumedMoles = reactionExtent * r.coefficient;
        resultingLiquidVolumeMl = Math.max(
          0,
          resultingLiquidVolumeMl - (consumedMoles * mw) / density
        );
      }
    }
  }

  const hasAqueousReactant = parsed.reactants.some(r => {
    const entry = inputByFormula.get(canonicalFormula(r.formula));
    return !!entry && isAqueousState(entry.state);
  });

  // Index AI metadata for names/colors.
  const aiByFormula = new Map<string, any>();
  for (const c of aiResults || []) {
    const f = cleanFormula(c?.formula || '');
    if (f) aiByFormula.set(f, c);
  }

  let gasVolumeMl = 0;
  const T = (Number.isFinite(temperatureC) ? temperatureC : 25) + 273.15;
  const P = Number.isFinite(pressureAtm) && pressureAtm > 0 ? pressureAtm : 1;

  type Prod = any & { _isAqueous?: boolean };
  const calculated: Prod[] = [];

  for (const p of parsed.products) {
    const productMoles = reactionExtent * p.coefficient;
    const key = cleanFormula(p.formula);
    const matchingAi = aiByFormula.get(key);
    const mw = formulaMolarMass(p.formula);
    if (!mw) continue;

    // Resolve state: AI → equation hint → gas table → liquid default
    const hint = p.stateHint;
    const fromHint =
      hint === 's' ? 'solid' :
      hint === 'g' ? 'gas' :
      hint === 'aq' ? 'aqueous' :
      hint === 'l' ? 'liquid' : '';
    const stateRaw = String(matchingAi?.state || fromHint || '').toLowerCase()
      || (GAS_FORMULA_HINTS.has(key) ? 'gas' : 'liquid');

    if (stateRaw === 'gas' || GAS_FORMULA_HINTS.has(key)) {
      // PV = nRT → volume in mL
      gasVolumeMl += productMoles * R_L_ATM * T / P * 1000;
      continue;
    }

    // Water formed in aqueous reactions is the solvent of the solution — it is
    // already counted in the conserved liquid volume assigned to aq products.
    // Skip listing free H2O when other dissolved products are present.
    const isWater = key === 'h2o';
    const isAq = stateRaw === 'aqueous' || hint === 'aq' || isAqueousState(stateRaw);
    if (isWater && !isAq) {
      // Pure liquid water product (no other aq species yet) — keep via density path below.
    }
    const normalizedState = normalizeChemicalState(isAq ? 'liquid' : stateRaw);
    const physical = productPhysicalQuantity(p.formula, isAq ? 'aq' : stateRaw, productMoles, mw);
    const fallback = matchingAi || {
      name: p.formula,
      formula: p.formula,
      defaultColor: normalizedState === 'solid' ? '#b0bec5' : '#a0d8ef',
      category: 'Reaction Products',
      state: normalizedState,
    };

    // Pure-liquid products contribute their own physical volume. Aqueous
    // products share the existing solution volume and therefore do not add a
    // separate volume. Water formed inside an aqueous reaction is part of that
    // shared solution rather than an additional liquid layer.
    if (!isAq && normalizedState === 'liquid' && physical.volumeMl > 0) {
      const isWater = key === 'h2o';
      if (!isWater || !hasAqueousReactant) {
        resultingLiquidVolumeMl += physical.volumeMl;
      }
    }

    calculated.push({
      ...fallback,
      formula: p.formula,
      state: normalizedState,
      amount: roundQuantity(physical.amount, 3),
      unit: physical.unit,
      moles: roundQuantity(productMoles, 6),
      massG: roundQuantity(physical.massG || 0, 3),
      volumeMl: roundQuantity(physical.volumeMl || 0, 3),
      _isAqueous: isAq,
    });
  }

  // One shared physical solution volume for the container (not per dissolved species).

  // Drop free H2O product when dissolved solutes are present — water is the solvent
  // of the shared solution volume, not a separate liquid entry.
  const hasAqSolute = calculated.some(
    c => c._isAqueous && canonicalFormula(c.formula) !== 'h2o'
  );
  let working = hasAqSolute
    ? calculated.filter(c => canonicalFormula(c.formula) !== 'h2o')
    : [...calculated];

  // Aqueous species keep solute mass (g). Do NOT divide the solution volume among them.
  for (const c of working) {
    if (c._isAqueous) {
      // amount/unit already set to solute grams by productPhysicalQuantity
      c.volumeMl = 0;
      const solutionVolumeL = resultingLiquidVolumeMl / 1000;
      if (solutionVolumeL > 0 && Number.isFinite(Number(c.moles))) {
        const solutionMolarity = Number(c.moles) / solutionVolumeL;
        c.concentration = roundQuantity(solutionMolarity, 6);
        c.molarity = roundQuantity(solutionMolarity, 6);
      }
      if (c.unit !== 'g' && Number(c.massG) > 0) {
        c.amount = roundQuantity(c.massG, 3);
        c.unit = 'g';
      }
    }
    delete c._isAqueous;
  }

  // Leftover (excess) reactants stay in the vessel. The conversion back to
  // desk units uses the aggregate physical pool, so identical chemicals with
  // different concentrations do not lose or gain moles during deduplication.
  for (const r of limitingReactants) {
    const key = canonicalFormula(r.formula);
    const entry = inputByFormula.get(key);
    if (!entry) continue;

    const available = reactantMoles.get(key) || 0;
    const consumed = reactionExtent * r.coefficient;
    const leftoverMoles = Math.max(0, available - consumed);
    if (leftoverMoles <= 1e-9) continue;

    const mw = formulaMolarMass(r.formula);
    if (!mw) continue;

    const s = entry.state;
    let amount: number;
    let unit: 'ml' | 'g';

    if (s === 'solid' || s === 's') {
      amount = leftoverMoles * mw;
      unit = 'g';
    } else if (s === 'gas' || s === 'g') {
      const temperatureK = (Number.isFinite(temperatureC) ? temperatureC : 25) + 273.15;
      amount = (leftoverMoles * R_L_ATM * temperatureK) / P * 1000;
      unit = 'ml';
    } else if (isPureLiquidInput(s, entry.chemical, r.formula)) {
      const density = getDensityGPerMl(r.formula);
      if (!density || density <= 0) continue;
      amount = (leftoverMoles * mw) / density;
      unit = 'ml';
    } else {
      // For a mixture of equal-formula aqueous inputs, calculate the effective
      // concentration from the actual aggregate moles / aggregate volume.
      const effectiveMolarity =
        entry.volumeMl > 0 ? entry.moles / (entry.volumeMl / 1000) : resolveAqueousMolarity(entry.chemical || {});
      if (!Number.isFinite(effectiveMolarity) || effectiveMolarity <= 0) continue;
      amount = (leftoverMoles / effectiveMolarity) * 1000;
      unit = 'ml';
    }

    const existing = working.find(c => formulaMatches(c.formula, r.formula));
    if (existing) {
      if (unit === 'g') {
        existing.amount = roundQuantity(Number(existing.amount || 0) + amount, 3);
        existing.massG = roundQuantity(Number(existing.massG || 0) + amount, 3);
        existing.moles = roundQuantity(Number(existing.moles || 0) + leftoverMoles, 6);
      } else if (existing.unit === 'g') {
        existing.massG = roundQuantity((existing.massG || existing.amount) + leftoverMoles * mw, 3);
        existing.amount = existing.massG;
        existing.moles = roundQuantity((existing.moles || 0) + leftoverMoles, 6);
      } else {
        existing.amount = roundQuantity(Number(existing.amount || 0) + amount, 3);
        existing.volumeMl = roundQuantity(Number(existing.volumeMl || 0) + amount, 3);
        existing.moles = roundQuantity(Number(existing.moles || 0) + leftoverMoles, 6);
      }
    } else {
      working.push({
        name: entry.chemical?.name || r.formula,
        formula: r.formula,
        state: normalizeChemicalState(s),
        defaultColor: entry.chemical?.defaultColor || '#ffffff',
        category: entry.chemical?.category || 'Reactants',
        amount: roundQuantity(amount, 3),
        unit,
        moles: roundQuantity(leftoverMoles, 6),
        massG: roundQuantity(leftoverMoles * mw, 3),
        volumeMl: unit === 'ml' ? roundQuantity(amount, 3) : 0,
      });
    }
  }

  // Preserve unrelated (spectator) chemicals that did not participate as
  // reactants. Their physical quantities come from the aggregate pool.
  for (const [key, entry] of inputByFormula.entries()) {
    if (reactantKeys.has(key)) continue;

    const s = entry.state;
    const isSolid = s === 'solid' || s === 's';
    const isGas = s === 'gas' || s === 'g';
    const existing = working.find(c => formulaMatches(c.formula, key));

    if (existing) {
      if (isSolid) {
        existing.amount = roundQuantity(Number(existing.amount || 0) + entry.massG, 3);
        existing.massG = roundQuantity(Number(existing.massG || 0) + entry.massG, 3);
      } else if (isGas) {
        // Gas spectators remain represented by the container gas state, not as
        // condensed contents. Keep the existing gas handling untouched.
        continue;
      } else {
        // If a spectator has the same formula as a product, merge by moles/mass.
        existing.moles = roundQuantity(Number(existing.moles || 0) + entry.moles, 6);
        existing.massG = roundQuantity(Number(existing.massG || 0) + entry.massG, 3);
        if (existing.unit === 'g') {
          existing.amount = existing.massG;
        }
      }
      continue;
    }

    if (isGas) continue;

    if (isSolid) {
      working.push({
        name: entry.chemical?.name || key,
        formula: key,
        state: 'solid',
        defaultColor: entry.chemical?.defaultColor || '#ffffff',
        category: entry.chemical?.category || 'Reagents',
        amount: roundQuantity(entry.massG, 3),
        unit: 'g',
        moles: roundQuantity(entry.moles, 6),
        massG: roundQuantity(entry.massG, 3),
        volumeMl: 0,
      });
    } else {
      // Keep an aqueous/pure-liquid spectator as a physical liquid entry.
      working.push({
        name: entry.chemical?.name || key,
        formula: key,
        state: normalizeChemicalState(s),
        defaultColor: entry.chemical?.defaultColor || '#ffffff',
        category: entry.chemical?.category || 'Reagents',
        amount: roundQuantity(entry.volumeMl, 3),
        unit: 'ml',
        moles: roundQuantity(entry.moles, 6),
        massG: roundQuantity(entry.massG, 3),
        volumeMl: roundQuantity(entry.volumeMl, 3),
      });
    }
  }

  // Canonical merge: same formula → one entry.
  const merged = new Map<string, any>();
  for (const c of working) {
    const key = canonicalFormula(c.formula);
    if (!key) continue;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...c, formula: key });
      continue;
    }
    prev.amount = roundQuantity(Number(prev.amount || 0) + Number(c.amount || 0), 3);
    if (prev.moles != null || c.moles != null) {
      prev.moles = roundQuantity(Number(prev.moles || 0) + Number(c.moles || 0), 6);
    }
    if (prev.massG != null || c.massG != null) {
      prev.massG = roundQuantity(Number(prev.massG || 0) + Number(c.massG || 0), 3);
    }
    if (prev.volumeMl != null || c.volumeMl != null) {
      prev.volumeMl = roundQuantity(Number(prev.volumeMl || 0) + Number(c.volumeMl || 0), 3);
    }
  }

  const gasRounded = roundQuantity(Math.max(0, gasVolumeMl), 3);

  return {
    resultingChemicals: Array.from(merged.values()),
    resultingLiquidVolumeMl: roundQuantity(resultingLiquidVolumeMl, 3),
    gasProduced: gasRounded > 0,
    gasVolumeMl: gasRounded,
    gasTemperatureC: temperatureC,
    gasPressureAtm: P,
    reactionExtentMoles: roundQuantity(reactionExtent, 6),
    quantityCalculation: {
      method: 'stoichiometric limiting-reagent calculation',
      inputUnitModel:
        'solids g; pure liquids mL→density→moles; aqueous mL×concentration (explicit or 1.00 M default, applied once); vessel gases mL via PV=nRT; air O2 unlimited',
      productUnitModel:
        'solids g; aqueous solutes g (shared solution volume in resultingLiquidVolumeMl); pure liquids mL when density known',
      gasModel: 'PV=nRT',
      temperatureC,
      pressureAtm: P,
      reactionExtentMoles: roundQuantity(reactionExtent, 6),
      defaultAqueousMolarity: DEFAULT_AQUEOUS_MOLARITY,
    },
  };
}
