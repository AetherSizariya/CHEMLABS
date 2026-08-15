export type QuantityUnit = 'ml' | 'g';

export type PhysicalQuantity = {
  amount: number;
  unit: QuantityUnit;
  moles?: number;
  massG?: number;
  volumeMl?: number;
};

export function normalizeChemicalState(state: string | undefined): 'solid' | 'liquid' | 'gas' {
  const s = String(state || '').toLowerCase();
  if (s === 'solid' || s === 's') return 'solid';
  if (s === 'gas' || s === 'g') return 'gas';
  return 'liquid';
}

export function isAqueousState(state: string | undefined): boolean {
  const s = String(state || '').toLowerCase();
  return s === 'aq' || s === 'aqueous' || s === 'solution';
}

/** Common pure-liquid densities (g/mL) at ~25 °C for volume conversion. */
export function getDensityGPerMl(formula: string | undefined): number | null {
  const f = String(formula || '').replace(/\s+/g, '').toLowerCase();
  const table: Record<string, number> = {
    h2o: 0.997,
    h2o2: 1.45,
    c2h5oh: 0.789,
    ch3oh: 0.792,
    c3h6o: 0.784, // acetone
    c3h8o: 0.786, // isopropanol
    c6h14: 0.659,
    c4h10o: 0.713, // diethyl ether
    c7h8: 0.867, // toluene
    ch2cl2: 1.33,
    c4h8o2: 0.902, // ethyl acetate
    br2: 3.12,
  };
  return table[f] ?? null;
}

/**
 * Convert stoichiometric product moles into a display quantity.
 *
 * Rules (what the student sees):
 * - solid  → grams of solid
 * - gas    → not placed in the vessel (amount 0); gas volume handled separately via PV=nRT
 * - aqueous / dissolved species → grams of solute (solution volume is container-level, not per species)
 * - pure liquid with known density → mL from mass/density
 * - otherwise → grams (honest fallback; we do not invent density)
 */
export function productPhysicalQuantity(
  formula: string,
  state: string | undefined,
  moles: number,
  molarMassGPerMol: number
): PhysicalQuantity {
  const normalizedState = normalizeChemicalState(state);
  const massG = moles * molarMassGPerMol;

  if (normalizedState === 'gas') {
    return { amount: 0, unit: 'ml', moles, massG, volumeMl: 0 };
  }

  if (normalizedState === 'solid') {
    return { amount: massG, unit: 'g', moles, massG, volumeMl: 0 };
  }

  // Dissolved/aqueous species: report solute mass. Do NOT invent a private liquid
  // volume for each species — the mixture has one shared solution volume.
  if (isAqueousState(state)) {
    return { amount: massG, unit: 'g', moles, massG, volumeMl: 0 };
  }

  const density = getDensityGPerMl(formula);
  if (density && density > 0) {
    const volumeMl = massG / density;
    return { amount: volumeMl, unit: 'ml', moles, massG, volumeMl };
  }

  // Unknown liquid density — report mass rather than inventing mL.
  return { amount: massG, unit: 'g', moles, massG, volumeMl: 0 };
}

export function contentVolumeMl(content: any): number {
  if (!content) return 0;
  if (Number.isFinite(Number(content.volumeMl)) && Number(content.volumeMl) > 0) {
    return Math.max(0, Number(content.volumeMl));
  }
  const state = normalizeChemicalState(content?.chemical?.state || content?.state);
  if (state === 'solid' || state === 'gas') return 0;
  const unit = content?.unit || 'ml';
  if (unit === 'ml') return Math.max(0, Number(content.amount) || 0);
  return 0;
}

export function sumLiquidVolumeMl(contents: any[] | undefined): number {
  return (contents || []).reduce((sum, content) => sum + contentVolumeMl(content), 0);
}

export function roundQuantity(amount: number, digits = 3): number {
  if (!Number.isFinite(amount)) return 0;
  const factor = 10 ** digits;
  return Math.round(amount * factor) / factor;
}

export function formatQuantity(content: any, digits = 1): string {
  const unit =
    content?.unit ||
    (normalizeChemicalState(content?.chemical?.state || content?.state) === 'solid' ? 'g' : 'ml');
  const amount = Number(content?.amount || 0);

  const formatOne = (n: number, u: string) => {
    if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6) return `${Math.round(n)}${u}`;
    const fixed = n.toFixed(digits);
    const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return `${trimmed}${u}`;
  };

  let main = formatOne(amount, unit);
  const massG = Number(content?.massG);
  // For solutions shown in mL, also show dissolved solute mass when known.
  if (unit === 'ml' && Number.isFinite(massG) && massG > 0.0005) {
    main = `${main} (${formatOne(massG, 'g')} solute)`;
  }
  return main;
}
