// Debug helper (not part of the gate): print the options, alerts and monitoring for generator seeds. Usage: npx tsx scripts/r2Show.ts 5000066 [more seeds]
import { gen2, run, chText } from './r2Generator';
const q = console.warn; console.warn = () => { };
for (const a of process.argv.slice(2)) {
    const seed = Number(a); const p = gen2(seed); const o = run(p);
    console.log(`===== seed ${seed}: K ${p.potassium} NYHA ${p.nyha_class} regimen ${p.current_regimen.map(r => r.med.name + ' ' + r.dose.strength + ' ' + r.selected_frequency).join(', ')}`);
    o.clinicalAlerts.forEach(x => console.log('  ALERT', x.slice(0, 130)));
    o.scoredRegimens.forEach((r, i) => console.log(`  opt${i + 1} [${Math.round(r.overall_score)}] ${chText(r).slice(0, 300)}\n      plan: ${(r.monitoring_plan ?? []).map(m => m.test.slice(0, 50)).join(' | ')}`));
    console.log('  monitoring:', o.monitoringPlan.map(m => m.test.slice(0, 40)).join(' | '));
}
console.warn = q;
