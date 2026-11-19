/**
 * Guideline reproduction REPORT (not a gate). Owner ruling 2026-11-15: the engine ranks on measured models, and guideline-shaped results are validation targets, never
 * enforced with points. This script asks, over the same scenario x insurance-tier runs as the golden set, how closely the new engine's lead option reproduces the guideline-concordance
 * score of the committed golden snapshot's lead. Output is also written to docs/outcome-evidence-2026-11-15/guideline-reproduction.txt.
 * Usage: npm run guideline:report
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { SCENARIOS } from '../data/scenarios';
import { MEDICATION_FORMULARY } from '../constants';
import type { ScoredRegimen } from '../types';
import { TARGET_DEFS, guidelineTargetSummary, type TargetResult } from './guidelineTargets';
import { INITIAL_PATIENT } from '../data/scenarios';
import { WEIGHT_PROFILES, SIDE_EFFECT_BURDEN_DIVISOR, KCCQ_FULL_CREDIT_POINTS } from '../services/engine/scoreModel';
import { calculateCostScore } from '../services/engine/domains';

interface OldPick { regimen?: { med: { name: string }; dose: { strength: number | string } }[]; domain_scores?: { guideline?: number } }
const label = (r: { regimen?: { med: { name: string }; dose: { strength: number | string } }[] } | undefined) =>
    !r ? '(no option)' : (r.regimen ?? []).map(m => `${m.med.name.split(' (')[0]} ${m.dose.strength}`).join(' + ');
const fx = (n: number, d = 1) => n.toFixed(d);

async function main() {
    // Frozen baseline: the lead of every run from the guideline-driven engine at commit a6cb28f (before the measured model). The live golden snapshot cannot be used:
    // it is refreshed with the current engine, which would compare the engine with itself.
    const old = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'golden', 'guideline-baseline-a6cb28f.json'), 'utf8')) as { runs: Record<string, { scoredRegimens?: OldPick[] }> }).runs;
    const names = MEDICATION_FORMULARY.map(m => m.name), available = new Set(names);
    const tiers = ['cash', 'commercial', 'medicare'] as const;
    interface Row { title: string; tier: string; oldLead: OldPick; oldG: number; newLead: ScoredRegimen; newG: number; top: boolean }
    const rows: Row[] = [];
    for (const sc of SCENARIOS) for (const tier of tiers) {
        const prices = await getDrugPrices(names, tier as never);
        const o = old[`${sc.title} :: ${tier}`]?.scoredRegimens?.[0];
        let out;
        try { out = generateAndScoreModifications({ ...sc.patient, insurance_tier: tier }, available, prices); } catch { continue; }
        const n = out.scoredRegimens[0];
        if (!o || !n) continue;
        const oldG = o.domain_scores?.guideline ?? NaN, newG = n.domain_scores.guideline;
        if (Number.isNaN(oldG)) continue;
        rows.push({ title: sc.title, tier, oldLead: o, oldG, newLead: n, newG, top: out.scoredRegimens.every(r => r.domain_scores.guideline <= newG) });
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const lines: string[] = [];
    lines.push(`Guideline reproduction report (a report, not a gate). ${rows.length} runs with a lead in both the guideline-driven baseline (commit a6cb28f) and the current engine.`);
    lines.push(`(1) mean guideline-concordance score of the lead: new ${fx(mean(rows.map(r => r.newG)), 2)} vs guideline-driven baseline ${fx(mean(rows.map(r => r.oldG)), 2)}`);
    lines.push(`(2) runs where the new lead's concordance is at least the old lead's: ${rows.filter(r => r.newG >= r.oldG).length} of ${rows.length} (${fx(100 * rows.filter(r => r.newG >= r.oldG).length / rows.length)}%)`);
    lines.push(`(3) runs where the new lead has the highest concordance among the displayed options: ${rows.filter(r => r.top).length} of ${rows.length} (${fx(100 * rows.filter(r => r.top).length / rows.length)}%)`);
    const byTitle = new Map<string, Row[]>();
    rows.forEach(r => byTitle.set(r.title, [...(byTitle.get(r.title) ?? []), r]));
    const groups = [...byTitle.entries()].map(([title, rs]) => ({ title, rs, shortfall: mean(rs.map(r => r.oldG - r.newG)) })).filter(g => g.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall).slice(0, 15);
    lines.push(`(4) the ${groups.length} scenario groups with the largest mean shortfall (old lead concordance minus new lead concordance, mean over insurance tiers):`);
    groups.forEach((g, i) => {
        const r = g.rs[0], e = r.newLead.outcome_estimates ?? [];
        // outcome_estimates are populated only for displayed picks, and the lead is always displayed.
        const rr = (k: number) => e[k] ? `${fx(e[k].rr, 2)} (${fx(e[k].ci_low, 2)}-${fx(e[k].ci_high, 2)})` : 'n/a';
        lines.push(`  ${i + 1}. ${g.title} [shortfall ${fx(g.shortfall)}; tier ${r.tier}]`);
        lines.push(`     old lead: ${label(r.oldLead)}  (concordance ${fx(mean(g.rs.map(x => x.oldG)))})`);
        lines.push(`     new lead: ${label(r.newLead)}  (concordance ${fx(mean(g.rs.map(x => x.newG)))})`);
        lines.push(`     new lead: death RR ${rr(0)}; HFH RR ${rr(1)}; symptom ${fx(r.newLead.symptom_estimate?.points ?? NaN)} KCCQ points; side-effect burden ${fx(r.newLead.harm_burden?.burden ?? NaN)}`);
    });
    // Guideline targets (the same definitions verify uses; scripts/guidelineTargets.ts): which option leads or is displayed per the guideline, measured and never gated.
    const targets: TargetResult[] = [];
    for (const sc of SCENARIOS) for (const def of TARGET_DEFS) if (def.match(sc.title)) {
        const prices = await getDrugPrices(names, sc.patient.insurance_tier as never);
        const displayed = generateAndScoreModifications(sc.patient, available, prices).scoredRegimens;
        targets.push({ name: `${def.name} [${sc.title}]`, ok: def.test(displayed), detail: def.detail });
    }
    lines.push(...guidelineTargetSummary(targets));
    // Scale sanity check: the five highest and five lowest raw scores among the leads, with the six weighted contributions.
    const sortedLeads = [...rows].sort((a, b) => b.newLead.raw_score! - a.newLead.raw_score!);
    const contrib = (r: ScoredRegimen) => r.score_breakdown!.domains.filter(d => d.weight > 0).map(d => `${d.key} ${fx(d.contribution)}`).join(' + ');
    const showLead = (r: Row) => `    raw ${fx(r.newLead.raw_score!, 1)} [${r.title}; ${r.tier}] ${label(r.newLead)} = ${contrib(r.newLead)}; adjustments ${r.newLead.score_breakdown!.adjustments.map(a => `${a.code} ${fx(a.points)}`).join(', ') || 'none'}`;
    lines.push('Scale check: the five highest and five lowest raw scores among the leads (weighted contributions in points):');
    sortedLeads.slice(0, 5).forEach(r => lines.push(showLead(r)));
    lines.push('    ...');
    sortedLeads.slice(-5).forEach(r => lines.push(showLead(r)));
    // Implied exchange rates of the default weight profile, in points of the 0-100 ranking score.
    const w = WEIGHT_PROFILES.default, budget = INITIAL_PATIENT.max_affordable_cost, sens = INITIAL_PATIENT.cost_sensitivity;
    const costDrop = (from: number) => w.cost * (calculateCostScore(from, budget, sens) - calculateCostScore(from + 10, budget, sens));
    lines.push('Implied exchange rates, default profile (points of the 0-100 ranking score):');
    lines.push(`  1 point of death-domain score (1 percentage point of relative risk reduction): ${fx(w.mortality, 3)}  (HF-hospitalization domain: ${fx(w.hf_hospitalization, 3)} per point)`);
    lines.push(`  1 burden point of side effects: ${fx(w.side_effects / SIDE_EFFECT_BURDEN_DIVISOR, 3)}  (side-effect weight ${w.side_effects} / divisor ${SIDE_EFFECT_BURDEN_DIVISOR})`);
    lines.push(`  1 KCCQ point: ${fx(w.symptoms * 100 / KCCQ_FULL_CREDIT_POINTS, 3)}  (symptom weight ${w.symptoms} x 100 / ${KCCQ_FULL_CREDIT_POINTS})`);
    lines.push(`  $10 a month at the default budget ($${budget}) and cost sensitivity (${sens}): ${fx(costDrop(50), 3)} from $50, ${fx(costDrop(100), 3)} from $100, ${fx(costDrop(300), 3)} from $300`);
    lines.push(`  so one burden point is worth ${fx((w.side_effects / SIDE_EFFECT_BURDEN_DIVISOR) / w.mortality, 2)} death-domain points; one KCCQ point ${fx((w.symptoms * 100 / KCCQ_FULL_CREDIT_POINTS) / w.mortality, 2)}; $10 a month (from $100) ${fx(costDrop(100) / w.mortality, 3)}.`);
    const text = lines.join('\n') + '\n';
    console.log(text);
    writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs/outcome-evidence-2026-11-15/guideline-reproduction.txt'), text);
}
main();
