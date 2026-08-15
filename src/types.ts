export type Chemical = {
  id: string;
  name: string;
  formula: string;
  defaultColor: string;
  category: string;
  state?: 'solid' | 'liquid' | 'gas';
};

export type ChemicalContent = {
  chemical: Chemical;
  amount: number;
  unit?: 'ml' | 'g';
  moles?: number;
  massG?: number;
  volumeMl?: number;
};

export type EquipmentShape = 
  | 'cylinder' 
  | 'sphere_bottom' 
  | 'cone_top' 
  | 'flat_dish' 
  | 'pipette' 
  | 'burner' 
  | 'heater' 
  | 'meter_temp' 
  | 'meter_ph'
  | 'meter_cond' 
  | 'balance'
  | 'stirrer'
  | 'tripod'
  | 'sunlight'
  | 'electrodes'
  | 'cooler'
  | 'mortar'
  | 'pestle'
  | 'box';

export type Equipment = {
  id: string;
  name: string;
  shape: EquipmentShape;
  capacity: number;
  radius: number;
  height: number;
  interactionRole?: 'burner' | 'candle' | 'heater' | 'other';
};

export type DeskItem = {
  id: string;
  equipment: Equipment;
  contents: ChemicalContent[];
  liquidColor: string;
  temperature?: number;
  equation?: string;
  pressure?: number;
  hasPrecipitate?: boolean;
  precipitateColor?: string;
  visualEffect?: string;
  isExploded?: boolean;
  gasProduced?: boolean;
  gasColor?: string;
  position: [number, number, number];
  position2DY?: number;
  rotation?: [number, number, number];
  isOn?: boolean; // For heaters/stirrers
  reading?: number; // For meters
  hydrogenIgnited?: boolean; // Whether hydrogen gas from this item has already popped near an open flame
  liquidVolumeMl?: number; // Physical liquid volume in the vessel, independent of dissolved-solute mass entries
};

export const CHEMICALS: Chemical[] = [
  // Solids
  { id: 's1', name: 'Sodium Chloride', formula: 'NaCl', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's2', name: 'Copper(II) Sulfate Pentahydrate', formula: 'CuSO4·5H2O', defaultColor: '#2196f3', category: 'Solids', state: 'solid' },
  { id: 's3', name: 'Potassium Permanganate', formula: 'KMnO4', defaultColor: '#800080', category: 'Solids', state: 'solid' },
  { id: 's4', name: 'Iron Filings', formula: 'Fe', defaultColor: '#424242', category: 'Solids', state: 'solid' },
  { id: 's5', name: 'Magnesium Ribbon', formula: 'Mg', defaultColor: '#b0bec5', category: 'Solids', state: 'solid' },
  { id: 's31', name: 'Coal', formula: 'C', defaultColor: '#333333', category: 'Solids', state: 'solid' },
  { id: 's6', name: 'Zinc Powder', formula: 'Zn', defaultColor: '#9e9e9e', category: 'Solids', state: 'solid' },
  { id: 's7', name: 'Calcium Carbonate', formula: 'CaCO3', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's8', name: 'Sodium Bicarbonate', formula: 'NaHCO3', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's9', name: 'Sodium Hydroxide Pellets', formula: 'NaOH', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's10', name: 'Potassium Nitrate', formula: 'KNO3', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's11', name: 'Sulfur Powder', formula: 'S', defaultColor: '#ffee58', category: 'Solids', state: 'solid' },
  { id: 's12', name: 'Iodine Crystals', formula: 'I2', defaultColor: '#4e342e', category: 'Solids', state: 'solid' },
  { id: 's13', name: 'Ammonium Nitrate', formula: 'NH4NO3', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's14', name: 'Barium Chloride', formula: 'BaCl2', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's15', name: 'Lead(II) Nitrate', formula: 'Pb(NO3)2', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's16', name: 'Calcium Chloride', formula: 'CaCl2', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's17', name: 'Sodium Acetate', formula: 'CH3COONa', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's18', name: 'Citric Acid', formula: 'C6H8O7', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's19', name: 'Ascorbic Acid (Vitamin C)', formula: 'C6H8O6', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's20', name: 'Copper(II) Oxide', formula: 'CuO', defaultColor: '#000000', category: 'Solids', state: 'solid' },
  { id: 's21', name: 'Zinc Oxide', formula: 'ZnO', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's22', name: 'Aluminium Powder', formula: 'Al', defaultColor: '#cfd8dc', category: 'Solids', state: 'solid' },
  { id: 's23', name: 'Iron(II) Sulfide', formula: 'FeS', defaultColor: '#212121', category: 'Solids', state: 'solid' },
  { id: 's24', name: 'Potassium Iodide', formula: 'KI', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's25', name: 'Potassium Dichromate', formula: 'K2Cr2O7', defaultColor: '#ff5722', category: 'Solids', state: 'solid' },
  { id: 's26', name: 'Sodium Thiosulfate', formula: 'Na2S2O3', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's27', name: 'Sodium Carbonate', formula: 'Na2CO3', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's28', name: 'Calcium Oxide', formula: 'CaO', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's29', name: 'Ammonium Chloride', formula: 'NH4Cl', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  { id: 's30', name: 'Glucose', formula: 'C6H12O6', defaultColor: '#ffffff', category: 'Solids', state: 'solid' },
  // Acids
  { id: 'c2', name: 'Hydrochloric Acid', formula: 'HCl', defaultColor: '#e0f7fa', category: 'Acids' },
  { id: 'c5', name: 'Sulfuric Acid', formula: 'H2SO4', defaultColor: '#eceff1', category: 'Acids' },
  { id: 'c11', name: 'Nitric Acid', formula: 'HNO3', defaultColor: '#fcfcfc', category: 'Acids' },
  { id: 'c12', name: 'Acetic Acid', formula: 'CH3COOH', defaultColor: '#fafafa', category: 'Acids' },
  { id: 'c13', name: 'Phosphoric Acid', formula: 'H3PO4', defaultColor: '#f0f0f0', category: 'Acids' },
  { id: 'c14', name: 'Formic Acid', formula: 'HCOOH', defaultColor: '#f1f1f1', category: 'Acids' },
  { id: 'c15', name: 'Citric Acid (aq)', formula: 'C6H8O7', defaultColor: '#f5f5f5', category: 'Acids' },
  { id: 'c16', name: 'Hydrobromic Acid', formula: 'HBr', defaultColor: '#f9f9f9', category: 'Acids' },
  { id: 'c17', name: 'Hydrofluoric Acid', formula: 'HF', defaultColor: '#fafafa', category: 'Acids' },
  { id: 'c18', name: 'Carbonic Acid', formula: 'H2CO3', defaultColor: '#f0f8ff', category: 'Acids' },

  // Bases
  { id: 'c3', name: 'Sodium Hydroxide (aq)', formula: 'NaOH', defaultColor: '#f3e5f5', category: 'Bases' },
  { id: 'c6', name: 'Ammonia (aq)', formula: 'NH3', defaultColor: '#e8f5e9', category: 'Bases' },
  { id: 'c19', name: 'Potassium Hydroxide (aq)', formula: 'KOH', defaultColor: '#f5f5f5', category: 'Bases' },
  { id: 'c20', name: 'Calcium Hydroxide (aq)', formula: 'Ca(OH)2', defaultColor: '#ffffff', category: 'Bases' },
  { id: 'c21', name: 'Barium Hydroxide (aq)', formula: 'Ba(OH)2', defaultColor: '#fafafa', category: 'Bases' },
  { id: 'c22', name: 'Sodium Carbonate (aq)', formula: 'Na2CO3', defaultColor: '#f9f9f9', category: 'Bases' },
  { id: 'c23', name: 'Sodium Bicarbonate (aq)', formula: 'NaHCO3', defaultColor: '#f4f4f4', category: 'Bases' },
  { id: 'c24', name: 'Lithium Hydroxide (aq)', formula: 'LiOH', defaultColor: '#fdfdfd', category: 'Bases' },
  { id: 'c25', name: 'Magnesium Hydroxide (aq)', formula: 'Mg(OH)2', defaultColor: '#fbfbfb', category: 'Bases' },

  // Solvents & Organic Liquids
  { id: 'c1', name: 'Water', formula: 'H2O', defaultColor: '#a0d8ef', category: 'Solvents' },
  { id: 'c9', name: 'Ethanol', formula: 'C2H5OH', defaultColor: '#ffffff', category: 'Solvents' },
  { id: 'c26', name: 'Methanol', formula: 'CH3OH', defaultColor: '#ffffff', category: 'Solvents' },
  { id: 'c27', name: 'Acetone', formula: 'C3H6O', defaultColor: '#ffffff', category: 'Solvents' },
  { id: 'c28', name: 'Isopropanol', formula: 'C3H8O', defaultColor: '#ffffff', category: 'Solvents' },
  { id: 'c29', name: 'Hexane', formula: 'C6H14', defaultColor: '#ffffff', category: 'Solvents' },
  { id: 'c30', name: 'Diethyl Ether', formula: 'C4H10O', defaultColor: '#ffffff', category: 'Solvents' },
  { id: 'c31', name: 'Toluene', formula: 'C7H8', defaultColor: '#ffffff', category: 'Solvents' },
  { id: 'c32', name: 'Dichloromethane', formula: 'CH2Cl2', defaultColor: '#ffffff', category: 'Solvents' },
  { id: 'c33', name: 'Ethyl Acetate', formula: 'C4H8O2', defaultColor: '#ffffff', category: 'Solvents' },

  // Indicators & Dyes
  { id: 'c10', name: 'Phenolphthalein', formula: 'C20H14O4', defaultColor: '#ffebee', category: 'Indicators' },
  { id: 'c34', name: 'Methyl Orange', formula: 'C14H14N3NaO3S', defaultColor: '#ff9800', category: 'Indicators' },
  { id: 'c35', name: 'Bromothymol Blue', formula: 'C27H28Br2O5S', defaultColor: '#2196f3', category: 'Indicators' },
  { id: 'c36', name: 'Litmus Solution', formula: 'Mixture', defaultColor: '#9c27b0', category: 'Indicators' },
  { id: 'c37', name: 'Universal Indicator', formula: 'Mixture', defaultColor: '#4caf50', category: 'Indicators' },
  { id: 'c38', name: 'Methylene Blue', formula: 'C16H18ClN3S', defaultColor: '#0d47a1', category: 'Indicators' },
  { id: 'c39', name: 'Indigo Carmine', formula: 'C16H8N2Na2O8S2', defaultColor: '#3f51b5', category: 'Indicators' },

  // Salt Solutions & Reagents
  { id: 'c4', name: 'Copper(II) Sulfate', formula: 'CuSO4', defaultColor: '#2196f3', category: 'Salt Solutions' },
  { id: 'c7', name: 'Potassium Permanganate', formula: 'KMnO4', defaultColor: '#9c27b0', category: 'Salt Solutions' },
  { id: 'c8', name: 'Hydrogen Peroxide', formula: 'H2O2', defaultColor: '#e3f2fd', category: 'Other Reagents' },
  { id: 'c40', name: 'Iron(III) Chloride', formula: 'FeCl3', defaultColor: '#ffb300', category: 'Salt Solutions' },
  { id: 'c41', name: 'Silver Nitrate', formula: 'AgNO3', defaultColor: '#f1f1f1', category: 'Salt Solutions' },
  { id: 'c42', name: 'Sodium Chloride (aq)', formula: 'NaCl', defaultColor: '#ffffff', category: 'Salt Solutions' },
  { id: 'c43', name: 'Potassium Iodide (aq)', formula: 'KI', defaultColor: '#fafafa', category: 'Salt Solutions' },
  { id: 'c44', name: 'Potassium Dichromate', formula: 'K2Cr2O7', defaultColor: '#ff5722', category: 'Salt Solutions' },
  { id: 'c45', name: 'Lead(II) Nitrate', formula: 'Pb(NO3)2', defaultColor: '#f5f5f5', category: 'Salt Solutions' },
  { id: 'c46', name: 'Cobalt(II) Chloride', formula: 'CoCl2', defaultColor: '#e91e63', category: 'Salt Solutions' },
  { id: 'c47', name: 'Nickel(II) Sulfate', formula: 'NiSO4', defaultColor: '#4caf50', category: 'Salt Solutions' },
  { id: 'c48', name: 'Zinc Sulfate', formula: 'ZnSO4', defaultColor: '#f0f0f0', category: 'Salt Solutions' },
  { id: 'c49', name: 'Ammonium Chloride', formula: 'NH4Cl', defaultColor: '#fafafa', category: 'Salt Solutions' },
  { id: 'c50', name: 'Barium Chloride', formula: 'BaCl2', defaultColor: '#f2f2f2', category: 'Salt Solutions' },
  { id: 'c51', name: 'Copper(II) Chloride', formula: 'CuCl2', defaultColor: '#00bcd4', category: 'Salt Solutions' },
  { id: 'c52', name: 'Sodium Thiosulfate', formula: 'Na2S2O3', defaultColor: '#fefefe', category: 'Salt Solutions' },
  { id: 'c53', name: 'Potassium Thiocyanate', formula: 'KSCN', defaultColor: '#fcfcfc', category: 'Salt Solutions' },
  { id: 'c54', name: 'Sodium Acetate', formula: 'CH3COONa', defaultColor: '#f0f0f0', category: 'Salt Solutions' },
  { id: 'c55', name: 'Magnesium Sulfate', formula: 'MgSO4', defaultColor: '#ffffff', category: 'Salt Solutions' },
  
  // Other Reagents
  { id: 'c56', name: 'Bromine Water', formula: 'Br2(aq)', defaultColor: '#ff7043', category: 'Other Reagents' },
  { id: 'c57', name: 'Iodine Solution', formula: 'I2(aq)', defaultColor: '#795548', category: 'Other Reagents' },
  { id: 'c58', name: 'Benedict\'s Reagent', formula: 'Mixture', defaultColor: '#1976d2', category: 'Other Reagents' },
  { id: 'c59', name: 'Fehling\'s Solution A', formula: 'CuSO4(aq)', defaultColor: '#2196f3', category: 'Other Reagents' },
  { id: 'c60', name: 'Fehling\'s Solution B', formula: 'Mixture', defaultColor: '#f0f0f0', category: 'Other Reagents' }
];

export const EQUIPMENTS: Equipment[] = [
  // Original
  { id: 'e1', name: 'Beaker', shape: 'cylinder', capacity: 250, radius: 0.3, height: 0.8 },
  { id: 'e2', name: 'Erlenmeyer Flask', shape: 'cone_top', capacity: 250, radius: 0.3, height: 1.0 },
  { id: 'e3', name: 'Test Tube', shape: 'cylinder', capacity: 25, radius: 0.1, height: 0.8 },
  { id: 'e4', name: 'Round Bottom Flask', shape: 'sphere_bottom', capacity: 500, radius: 0.4, height: 1.2 },
  { id: 'e5', name: 'Graduated Cylinder', shape: 'cylinder', capacity: 100, radius: 0.15, height: 1.2 },
  { id: 'e6', name: 'Volumetric Flask', shape: 'sphere_bottom', capacity: 250, radius: 0.35, height: 1.2 },
  { id: 'e7', name: 'Petri Dish', shape: 'flat_dish', capacity: 50, radius: 0.4, height: 0.15 },
  { id: 'e8', name: 'Crucible', shape: 'cone_top', capacity: 30, radius: 0.15, height: 0.3 },
  { id: 'e9', name: 'Watch Glass', shape: 'flat_dish', capacity: 10, radius: 0.3, height: 0.05 },
  { id: 'e10', name: 'Evaporating Dish', shape: 'flat_dish', capacity: 100, radius: 0.3, height: 0.2 },
  // New 30
  { id: 'e11', name: 'Bunsen Burner', shape: 'burner', capacity: 50, radius: 0.15, height: 0.4, interactionRole: 'burner' },
  { id: 'e12', name: 'Hot Plate', shape: 'heater', capacity: 0, radius: 0.4, height: 0.15 },
  { id: 'e13', name: 'Thermometer', shape: 'meter_temp', capacity: 0, radius: 0.05, height: 1.5 },
  { id: 'e14', name: 'pH Meter', shape: 'meter_ph', capacity: 0, radius: 0.1, height: 1.0 },
  { id: 'e15', name: 'Digital Balance', shape: 'balance', capacity: 0, radius: 0.5, height: 0.2 },
  { id: 'e16', name: 'Magnetic Stirrer', shape: 'stirrer', capacity: 0, radius: 0.4, height: 0.15 },
  { id: 'e17', name: 'Pipette', shape: 'pipette', capacity: 10, radius: 0.05, height: 1.0 },
  { id: 'e18', name: 'Buret', shape: 'pipette', capacity: 50, radius: 0.08, height: 1.5 },
  { id: 'e19', name: 'Dropper', shape: 'pipette', capacity: 5, radius: 0.04, height: 0.5 },
  { id: 'e20', name: 'Separatory Funnel', shape: 'cone_top', capacity: 250, radius: 0.3, height: 1.2 },
  { id: 'e21', name: 'Florence Flask', shape: 'sphere_bottom', capacity: 500, radius: 0.4, height: 1.0 },
  { id: 'e22', name: 'Filtering Flask', shape: 'cone_top', capacity: 250, radius: 0.3, height: 1.0 },
  { id: 'e23', name: 'Mortar', shape: 'mortar', capacity: 100, radius: 0.25, height: 0.2 },
  { id: 'e24', name: 'Pestle', shape: 'pestle', capacity: 0, radius: 0.05, height: 0.4 },
  { id: 'e25', name: 'Desiccator', shape: 'cylinder', capacity: 1000, radius: 0.6, height: 0.8 },
  { id: 'e26', name: 'Wash Bottle', shape: 'cylinder', capacity: 500, radius: 0.25, height: 0.8 },
  { id: 'e27', name: 'Centrifuge Tube', shape: 'cone_top', capacity: 15, radius: 0.08, height: 0.6 },
  { id: 'e28', name: 'Calorimeter', shape: 'cylinder', capacity: 300, radius: 0.35, height: 0.6 },
  { id: 'e29', name: 'Meker Burner', shape: 'burner', capacity: 50, radius: 0.2, height: 0.5, interactionRole: 'burner' },
  { id: 'e30', name: 'Spirit Lamp', shape: 'burner', capacity: 100, radius: 0.2, height: 0.3, interactionRole: 'burner' },
  { id: 'e31', name: 'Heat Lamp', shape: 'heater', capacity: 0, radius: 0.3, height: 0.8 },
  { id: 'e32', name: 'Heating Mantle', shape: 'heater', capacity: 0, radius: 0.5, height: 0.4 },
  { id: 'e33', name: 'Conductivity Meter', shape: 'meter_cond', capacity: 0, radius: 0.1, height: 1.0 },
  { id: 'e36', name: 'Tripod', shape: 'tripod', capacity: 0, radius: 0.3, height: 0.6 },
  { id: 'e37', name: 'Wire Gauze', shape: 'flat_dish', capacity: 0, radius: 0.3, height: 0.01 },
  { id: 'e38', name: 'Glass Rod', shape: 'pipette', capacity: 0, radius: 0.02, height: 0.8 },
  { id: 'e39', name: 'Volumetric Pipette', shape: 'pipette', capacity: 25, radius: 0.06, height: 1.2 },
  { id: 'e40', name: 'Gas Syringe', shape: 'cylinder', capacity: 100, radius: 0.15, height: 0.8 },
  { id: 'e41', name: 'UV Lamp (Sunlight)', shape: 'sunlight', capacity: 0, radius: 0.3, height: 0.8 },
  { id: 'e42', name: 'Electrodes (Battery)', shape: 'electrodes', capacity: 0, radius: 0.2, height: 0.5 },
  { id: 'e43', name: 'Cooling Bath (Ice)', shape: 'cooler', capacity: 0, radius: 0.3, height: 0.2 },
  { id: 'e44', name: 'Candle', shape: 'burner', capacity: 50, radius: 0.1, height: 0.2, interactionRole: 'candle' },


];
