/** Drug-class registry and class-group helpers (single source of truth for class behavior). Moved verbatim from simulationService.ts (phase 4). */


// =====================================================================================
// DRUG-CLASS REGISTRY — single source of truth for class behavior.
//
// Every fact the engine needs about a drug class lives here, instead of being re-encoded
// across ~80 inline `drug_class === '...'` branches and several parallel Set literals.
// Adding a new class (or therapy of a new class) means adding ONE row here plus the
// formulary entry — not grep-and-patching the engine. A missing membership becomes a
// missing row (one place to check), not a silent clinical error scattered across files.
//
// `flags`:
//   raas                          → counts as RAAS-inhibitor blockade (dual-RAAS prevention, etc.)
//   mra                           → mineralocorticoid blockade (dual-MRA prevention, grouping)
//   diuretic                      → loop / thiazide volume management
//   disease-modifying             → GDMT/adjunct that alters disease course (STRONG-HF follow-up trigger)
//   volume-sensitive-intensifier  → initiation deferred while a patient is volume-depleted on diuretics
// `group`: the class-GROUP used for "one-per-group" logic (RAAS pool, MRA pool, GLP-1 pool).
// `dbpRatio`: drug-class-specific SBP→DBP coupling (see evidence block near getDbpRatio).
// =====================================================================================
export type ClassFlag = 'raas' | 'mra' | 'diuretic' | 'disease-modifying' | 'volume-sensitive-intensifier';

export interface ClassMeta { group: string; dbpRatio: number; flags: ClassFlag[]; }

export const DRUG_CLASS_REGISTRY: Record<string, ClassMeta> = {
    'ARNI':                   { group: 'RAAS Inhibitor', dbpRatio: 0.50, flags: ['raas', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'ACEi':                   { group: 'RAAS Inhibitor', dbpRatio: 0.50, flags: ['raas', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'ARB':                    { group: 'RAAS Inhibitor', dbpRatio: 0.50, flags: ['raas', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'Beta Blocker':           { group: 'Beta Blocker', dbpRatio: 0.70, flags: ['disease-modifying'] },
    'MRA':                    { group: 'MRA', dbpRatio: 0.60, flags: ['mra', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'nsMRA':                  { group: 'MRA', dbpRatio: 0.50, flags: ['mra', 'disease-modifying', 'volume-sensitive-intensifier'] },
    'SGLT2i':                 { group: 'SGLT2i', dbpRatio: 0.40, flags: ['disease-modifying', 'volume-sensitive-intensifier'] },
    'Loop Diuretic':          { group: 'Loop Diuretic', dbpRatio: 0.50, flags: ['diuretic'] },
    'Thiazide-like Diuretic': { group: 'Thiazide-like Diuretic', dbpRatio: 0.50, flags: ['diuretic'] },
    'Vasodilator':            { group: 'Vasodilator', dbpRatio: 0.50, flags: [] },
    'sGC Stimulator':         { group: 'sGC Stimulator', dbpRatio: 0.55, flags: ['disease-modifying'] },
    'If Inhibitor':           { group: 'If Inhibitor', dbpRatio: 0.60, flags: [] },
    'Inotrope':               { group: 'Inotrope', dbpRatio: 0.60, flags: [] },
    'GLP-1 RA':               { group: 'GLP-1 Therapy', dbpRatio: 0.60, flags: [] },
    'GLP-1/GIP RA':           { group: 'GLP-1 Therapy', dbpRatio: 0.60, flags: [] },
    'IV Iron':                { group: 'IV Iron', dbpRatio: 0.60, flags: [] },
    'K+ Binder':              { group: 'K+ Binder', dbpRatio: 0.60, flags: [] },
};

export function classesWithFlag(flag: ClassFlag): Set<string> {
    return new Set(Object.entries(DRUG_CLASS_REGISTRY).filter(([, v]) => v.flags.includes(flag)).map(([k]) => k));
}

export function getMedicationClassGroup(drugClass: string): string {
    return DRUG_CLASS_REGISTRY[drugClass]?.group ?? drugClass;
}

// hasHistoricalHFrEF / hasUnknownHistoricalHFrEF now live in services/clinicalPredicates.ts
// (shared with constants.ts so formulary and engine gating cannot drift).

// Derived from DRUG_CLASS_REGISTRY — single source of truth (see top of file).
export const RAAS_CLASSES = classesWithFlag('raas');

export const DIURETIC_CLASSES = classesWithFlag('diuretic');

export const VOLUME_SENSITIVE_INTENSIFICATION_CLASSES = classesWithFlag('volume-sensitive-intensifier');

export const MRA_POOL_CLASSES = classesWithFlag('mra'); // steroidal MRA + nsMRA (registry-derived)

export function isDiureticClass(drugClass: string): boolean {
    return DIURETIC_CLASSES.has(drugClass);
}

// STRONG-HF high-intensity follow-up schedule. Triggered when a disease-modifying class
// is initiated/up-titrated — safe practice is rapid sequencing with structured early
// reassessment, not a single cross-sectional decision.
export const DISEASE_MODIFYING_CLASSES = classesWithFlag('disease-modifying');

// --- DBP Coupling: Drug-class-specific SBP→DBP ratios ---
// Vasodilators widen pulse pressure (DBP drops less); BB drops DBP proportionally.
//
// Evidence basis for each ratio:
//   RAAS (0.50): PARADIGM-HF — sacubitril/valsartan reduced SBP ~3.2 mmHg vs enalapril
//     with proportionally smaller DBP effect due to arterial vasodilation (pulse pressure widening).
//   BB (0.70): COPERNICUS, MERIT-HF — beta-blockers reduce cardiac output symmetrically,
//     dropping SBP and DBP in roughly proportional fashion. 0.70 accounts for mild reflex.
//   Diuretics (0.50): Volume unloading reduces preload more than afterload.
//   SGLT2i (0.40): DAPA-HF, EMPA-REG — osmotic/natriuretic mechanism lowers SBP ~2-4 mmHg
//     with minimal DBP effect (primarily preload, not arterial tone).
//   H/ISDN (0.50): A-HeFT — direct arteriolar/venous vasodilation widens pulse pressure.
//   sGC Stimulator (0.55): VICTORIA — vericiguat has modest balanced vasodilation.
//   nsMRA (0.50): FINEARTS-HF — anti-fibrotic with mild natriuretic (preload-dominant).
export function getDbpRatio(drugClass: string): number {
    return DRUG_CLASS_REGISTRY[drugClass]?.dbpRatio ?? 0.60;
}

// --- 3. Modification-Based Simulation (Delta Engine) ---
