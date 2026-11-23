import raw from '../docs/evidence-matrix.md?raw';

// docs/evidence-matrix.md is the single source of truth for rule -> evidence rows. This module only
// parses it; it never restates a row. Each table row has eight pipe-separated cells (checked by
// `parseEvidenceMatrix`: a row with any other cell count is kept as a plain paragraph, not guessed at).

export interface EvidenceRow {
    id: string;
    behavior: string;
    location: string;
    rationale: string;
    anchor: string;
    strength: string;
    calibration: string;
    risk: string;
}

export interface EvidenceSection {
    title: string;
    notes: string[];
    rows: EvidenceRow[];
}

const CELLS = 8;

/** Remove markdown emphasis/backticks so the text reads as plain clinical English. */
export const plain = (t: string): string => t.replace(/`/g, '').replace(/\*\*/g, '')
    .split(/(https?:\/\/\S+)/).map((part, i) => (i % 2 === 1 ? part : cleanInternalNames(part))).join('');

/** Code constants named in the matrix text, in the words a clinician reads (T20): no programming identifier is shown. */
const CONSTANT_WORDS: Record<string, string> = {
    ALLERGY_ALIASES_BY_DRUG: 'the allergy name list', BASE_WEIGHTS: 'the base weights', BB_HR_BELOW: 'the beta-blocker heart-rate limit', BB_HR_BELOW_ESC: 'the guideline beta-blocker heart-rate limit',
    BB_S6_START_NOTE: 'the beta-blocker start note', BOXED_FETAL_TOXICITY: 'the boxed fetal-toxicity warning', CHILDBEARING_POTENTIAL_AGE_BELOW: 'the childbearing-age limit',
    CI_ADRENAL_INSUFFICIENCY: 'the adrenal insufficiency contraindication', CI_ALISKIREN_DIABETES: 'the aliskiren and diabetes contraindication', CI_ANURIA: 'the anuria contraindication',
    CI_MRA_WITHHOLD_K6: 'the MRA withhold at potassium 6.0', CI_SEVERE_HEPATIC_UNSPECIFIED: 'the severe liver disease contraindication', CI_SICK_SINUS_NO_PACEMAKER: 'the sick sinus syndrome contraindication',
    CI_STRONG_CYP3A: 'the strong CYP3A inhibitor contraindication', COMPLETENESS_GRADED_CREDIT_SPAN: 'the graded completeness credit', COMPLETENESS_SUBTARGET_CREDIT: 'the below-target completeness credit',
    CONCORDANCE_TABLE: 'the guideline concordance table', CONGESTION_EXCESS_KG_ABOVE: 'the congestion weight limit', DISPLAY_ONLY_OPTIONS: 'the display-only form options', DRUG_PRICES: 'the price table',
    ELIGIBILITY_RULES: 'the eligibility rules', EXTERNAL_POTASSIUM_RAISERS: 'the list of outside potassium-raising medicines', INTOLERANCE_TABLE: 'the intolerance table',
    LIVER_B_CONFIRMED: 'the confirmed Child-Pugh B option', LONG_ACTING_NITRATES: 'the long-acting nitrate list', LOOP_LOW_EGFR_ITEM: 'the loop diuretic low-eGFR monitoring item',
    MRA_HALVE_DOSE_EGFR_BELOW: 'the MRA dose-halving eGFR limit', MRA_POTASSIUM_STAGED_MONITORING: 'the staged MRA potassium monitoring', MRA_START_EGFR_MAX: 'the MRA start eGFR limit',
    OTHER_SGC_STIMULATORS: 'the list of other sGC stimulators', OUTCOME_TAU2: 'the death and hospitalization priors', PDE5_INHIBITORS: 'the PDE-5 inhibitor list',
    POTASSIUM_RAISER_REVIEW_K: 'the potassium level for reviewing potassium-raising medicines', PROFILE_MULTIPLIERS: 'the preference multipliers', RAAS_EGFR_REVIEW_BELOW: 'the RAAS inhibitor eGFR review limit',
    RAAS_K_FACTS: 'the RAAS inhibitor potassium facts', RAAS_START_K_CAUTION: 'the RAAS inhibitor start potassium caution', RELEVANT_COMORBIDITIES: 'the list of relevant conditions',
    RELEVANT_EXTERNAL_MEDICATIONS: 'the list of relevant outside medicines', SHRINKAGE_FORMULA: 'the weighting formula', SYMPTOM_TAU2: 'the health-status prior',
    UP_TITRATION_MAX_DAILY_FACTOR: 'the dose-increase limit', WEIGHT_PROFILES: 'the weight profiles',
};
const TOOL_POLICY = 'tool policy: not from a trial or guideline';

/** File names and programming identifiers are not clinician text: a file becomes "the project record", a constant becomes words, an identifier with underscores becomes words. Web addresses are left alone. "Engine policy" reads "tool policy: not from a trial or guideline" (T20). */
function cleanInternalNames(t: string): string {
    return t
        .replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/g, m => CONSTANT_WORDS[m] ?? m.toLowerCase().replace(/_/g, ' '))
        .replace(/\b(?:[\w-]+\/)*[\w-]+\.(?:md|ts|tsx|json|mjs|py)\b/g, 'the project record')
        .replace(/\bfacts\.([a-z0-9_]+)/g, (_m, f: string) => f.replace(/_/g, ' '))
        .replace(/\bmeta_analysis\b/g, 'pooled analysis')
        .replace(/\b([a-z]+)(?:_([a-z0-9]+))+\b/g, m => m.replace(/_/g, ' '))
        .replace(/Reviewer findings?\s+(?:[a-z-]+\s+B\d+(?:,\s*)?)+/gi, 'Found in an internal review')
        .replace(/\brulings? R\d+(?: to R\d+)?/gi, 'decisions').replace(/\brulings\b/g, 'decisions').replace(/\b(?:controller|owner) (?:rulings?|decisions?|recommendations?)\b/gi, 'project decision').replace(/\bowner review\b/gi, 'review by the project owner')
        .replace(/\bENGINE POLICY\b|\bengine policy\b/gi, TOOL_POLICY)
        .replace(new RegExp(`(${TOOL_POLICY})(,? (?:and )?not (?:a )?guideline[- ]?(?:derived|statement)?)`, 'g'), '$1')
        .replace(/\bThe engine\b/g, 'The tool').replace(/\bthe engine\b/g, 'the tool').replace(/\bengine\b/g, 'tool').replace(/\bEngine (rule|selection policy|choice)\b/g, 'Tool $1').replace(/\bENGINE\b/g, 'TOOL')
        .replace(/(the project record)(,? (?:and )?the project record)+/g, '$1');
}

export function parseEvidenceMatrix(text: string): { intro: string[]; sections: EvidenceSection[] } {
    const intro: string[] = [];
    const sections: EvidenceSection[] = [];
    let current: EvidenceSection | null = null;
    let skipping = false;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('# ')) continue;
        if (line.startsWith('## ')) {
            const title = plain(line.slice(3).trim());
            // "How to use this matrix" explains the code-level columns; the on-screen table has its own header.
            skipping = /^how to use/i.test(title);
            current = skipping ? null : { title, notes: [], rows: [] };
            if (current) sections.push(current);
            continue;
        }
        if (skipping) continue;
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('|')) {
            const cells = trimmed.replace(/^\|\s?/, '').replace(/\s?\|$/, '').split(' | ').map(c => c.trim());
            if (cells.length !== CELLS) { current?.notes.push(plain(trimmed)); continue; }
            if (cells[0] === 'Rule ID' || /^-+$/.test(cells[0])) continue;
            const [id, behavior, location, rationale, anchor, strength, calibration, risk] = cells.map(plain);
            current?.rows.push({ id, behavior, location, rationale, anchor, strength, calibration, risk });
            continue;
        }
        if (/^[-*] /.test(trimmed)) continue; // bullet lists in the preamble describe code columns
        (current ? current.notes : intro).push(plain(trimmed));
    }
    return { intro, sections: sections.filter(s => s.rows.length > 0 || s.notes.length > 0) };
}

export const EVIDENCE_MATRIX = parseEvidenceMatrix(raw);
export const ALL_EVIDENCE_ROWS: EvidenceRow[] = EVIDENCE_MATRIX.sections.flatMap(s => s.rows);

const rowText = (r: EvidenceRow) => `${r.id} ${r.behavior} ${r.rationale} ${r.anchor} ${r.strength} ${r.calibration} ${r.risk}`.toLowerCase();

export function rowMatches(r: EvidenceRow, query: string): boolean {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = rowText(r);
    return terms.every(t => hay.includes(t));
}

/** First word of a formulary name ("Eplerenone", "Sacubitril", "Furoscix"): the search term used to find a drug's rows. */
export const drugSearchTerm = (name: string): string => name.split(/[\s(/]/)[0];

/** Rows whose behavior text names the drug. Matched on the visible rule text only, by drug name. */
export function evidenceRowsForDrug(name: string): EvidenceRow[] {
    const term = drugSearchTerm(name).toLowerCase();
    if (term.length < 4) return [];
    return ALL_EVIDENCE_ROWS.filter(r => r.behavior.toLowerCase().includes(term));
}
