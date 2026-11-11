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
export const plain = (t: string): string => t.replace(/`/g, '').replace(/\*\*/g, '');

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
