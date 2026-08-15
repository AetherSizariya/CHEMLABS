/**
 * Reaction identity & quantity profiles.
 *
 * Design:
 * - Reaction identity (hash / cache key) NEVER includes amounts.
 *   10 mL HCl + Zn and 50 mL HCl + Zn are the SAME reaction document.
 * - Quantity profiles store stoichiometric product yields as moles of product
 *   per mole of reaction extent (or absolute moles at a reference extent),
 *   plus reference reactant amounts so we can scale.
 * - Display units (mL / g) are applied when the profile is evaluated against
 *   the current input quantities — not baked into the identity.
 */

export type ReactionProfileInput = {
  name: string;
  formula: string;
  state: 'solid' | 'liquid' | 'gas';
  /** Amount in g for solids, mL for liquids/solutions/gases (as stored on the desk). */
  amount: number;
  chemical?: any;
};

export type ReactionProfileProduct = {
  name: string;
  formula: string;
  state: 'solid' | 'liquid' | 'gas';
  /** Display amount after scaling (mL or g). */
  amount: number;
  unit: 'ml' | 'g';
  moles?: number;
  massG?: number;
  volumeMl?: number;
  defaultColor?: string;
  category?: string;
};

/**
 * Version 3 profile: stores reference product metadata for cache/debugging.
 * It is never authoritative for current quantities; the deterministic engine
 * recalculates quantities from the current inputs.
 */
export type ReactionQuantityProfile = {
  version: 3;
  reactionCode: string;
  referenceInputs: ReactionProfileInput[];
  /** Formulas that can limit the reaction (excludes air O2/N2). */
  limitingInputFormulas: string[];
  referenceProducts: ReactionProfileProduct[];
  referenceGasVolumeMl?: number;
  /** Reaction extent in moles at the reference experiment. */
  referenceExtentMoles?: number;
  scaleDescription: string;
};

export type EquationSpecies = { coefficient: number; formula: string; stateHint?: string };

export function cleanFormula(formula: string): string {
  return String(formula || '')
    .replace(/\s+/g, '')
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch)))
    .replace(/₂/g, '2')
    .replace(/₃/g, '3')
    .replace(/₄/g, '4')
    .replace(/\((aq|l|s|g)\)$/i, '')
    .replace(/[⁺⁻+\-]\d*$/u, '')
    .replace(/\^\d*[+-]$/, '')
    .toLowerCase();
}

const AIR_FORMULAS = new Set(['o2', 'n2', 'ar']);

function parseEquationSide(side: string): EquationSpecies[] {
  return side
    .split('+')
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => {
      const match = token.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
      const raw = match ? match[2] : token;
      const stateMatch = raw.match(/\((aq|l|s|g)\)\s*$/i);
      const stateHint = stateMatch ? stateMatch[1].toLowerCase() : undefined;
      return {
        coefficient: match ? Number(match[1]) : 1,
        formula: cleanFormula(raw.replace(/\s*\([^)]*\)\s*$/, '')),
        stateHint,
      };
    });
}

export function parseBalancedEquation(
  equation: string
): { reactants: EquationSpecies[]; products: EquationSpecies[] } | null {
  const normalized = String(equation || '').replace(/→|⟶|⇒|->|=>/g, '→');
  const parts = normalized.split('→');
  if (parts.length !== 2) return null;
  const reactants = parseEquationSide(parts[0]);
  const products = parseEquationSide(parts[1]);
  return reactants.length > 0 && products.length > 0 ? { reactants, products } : null;
}

/**
 * Build the quantity-independent cache key payload.
 * Amounts are intentionally omitted so different pour volumes share one reaction doc.
 */
export function buildReactionCachePayload(payload: any) {
  const allChemicals: any[] = [];
  if (Array.isArray(payload?.sourceChemicals)) allChemicals.push(...payload.sourceChemicals);
  if (Array.isArray(payload?.targetChemicals)) allChemicals.push(...payload.targetChemicals);

  const chemMap = new Map<string, any>();
  for (const c of allChemicals) {
    const chemical = c?.chemical || c || {};
    const formula = cleanFormula(chemical.formula || '');
    const name = String(chemical.name || formula || '')
      .trim()
      .toLowerCase();
    const identity = formula || name;
    if (!identity) continue;
    if (!chemMap.has(identity)) {
      chemMap.set(identity, {
        name,
        formula: formula || name,
        state: String(chemical.state || 'liquid').toLowerCase(),
      });
    }
  }

  const chemicals = Array.from(chemMap.values()).sort((a, b) =>
    `${a.formula}|${a.name}`.localeCompare(`${b.formula}|${b.name}`)
  );

  const action = payload?.action || 'mix';
  return {
    reactionModelVersion: 5,
    action,
    chemicals,
    // Equipment / temperature only matter for process actions (heat, electrolyze, …).
    targetEquipment: action === 'mix' ? null : payload?.targetEquipment || null,
    temperature: action === 'mix' ? null : Math.round(Number(payload?.temperature ?? 25)),
    pressure: Number(payload?.pressure ?? 1),
    reactionTime: payload?.reactionTime || null,
    reactionRate: payload?.reactionRate || null,
  };
}

export function makeReactionCode(hash: string): string {
  return `RXN-${String(hash).slice(0, 8).toUpperCase()}`;
}

function normalizedInputList(inputChemicals: any[]): ReactionProfileInput[] {
  const map = new Map<string, ReactionProfileInput>();
  for (const c of inputChemicals || []) {
    const chemical = c?.chemical || c || {};
    const formula = cleanFormula(chemical.formula || chemical.name || '');
    if (!formula) continue;
    const previous = map.get(formula);
    const item: ReactionProfileInput = {
      name: String(chemical.name || formula),
      formula,
      state: String(chemical.state || 'liquid').toLowerCase() as any,
      amount: Number(c?.amount || 0),
      chemical,
    };
    if (previous) previous.amount += item.amount;
    else map.set(formula, item);
  }
  return Array.from(map.values()).filter(item => item.amount > 0);
}

/**
 * Build a scalable quantity profile from a completed reference experiment.
 * Stores reference metadata for cache/debugging. Actual quantities are always
 * recomputed by the deterministic stoichiometry engine for current inputs.
 */
export function buildQuantityProfile(
  reactionCode: string,
  equation: string,
  inputChemicals: any[],
  resultingChemicals: any[],
  gasVolumeMl?: number,
  referenceExtentMoles?: number
): ReactionQuantityProfile | null {
  const inputs = normalizedInputList(inputChemicals);
  if (!inputs.length) return null;

  const parsed = parseBalancedEquation(equation);
  const limitingInputFormulas =
    parsed?.reactants
      ?.map(r => cleanFormula(r.formula))
      .filter(f => f && !AIR_FORMULAS.has(f)) || inputs.map(i => i.formula);

  const referenceProducts = (resultingChemicals || [])
    .filter((p: any) => Number(p?.amount) > 0 || Number(p?.moles) > 0)
    .map((p: any) => ({
      name: String(p?.name || p?.formula || 'Product'),
      formula: cleanFormula(p?.formula || p?.name || ''),
      state: String(p?.state || 'liquid').toLowerCase() as any,
      amount: Number(p?.amount || 0),
      unit: (p?.unit === 'g' ? 'g' : 'ml') as 'ml' | 'g',
      moles: Number.isFinite(Number(p?.moles)) ? Number(p.moles) : undefined,
      massG: Number.isFinite(Number(p?.massG)) ? Number(p.massG) : undefined,
      volumeMl: Number.isFinite(Number(p?.volumeMl)) ? Number(p.volumeMl) : undefined,
      defaultColor: p?.defaultColor,
      category: p?.category,
    }))
    .filter(p => p.formula && (p.amount > 0 || (p.moles != null && p.moles > 0)));

  if (!referenceProducts.length && !(Number(gasVolumeMl) > 0)) return null;

  return {
    version: 3,
    reactionCode,
    referenceInputs: inputs.map(({ chemical, ...rest }) => rest),
    limitingInputFormulas: Array.from(new Set(limitingInputFormulas)),
    referenceProducts,
    ...(Number(gasVolumeMl) > 0 ? { referenceGasVolumeMl: Number(gasVolumeMl) } : {}),
    ...(referenceExtentMoles != null && Number.isFinite(referenceExtentMoles)
      ? { referenceExtentMoles }
      : {}),
    scaleDescription:
      'Product quantities scale with the limiting reactant. Same reaction identity is reused for all input amounts.',
  };
}
