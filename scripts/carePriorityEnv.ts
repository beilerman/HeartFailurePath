/**
 * Audit helper: set CARE_PRIORITY=outcomes_first|cost_first|simplicity_first to run an audit with
 * that patient-selected weight profile applied to every patient. Unset or unknown => unchanged.
 */
import type { Patient } from '../types';
import { WEIGHT_PROFILES, type WeightProfileName } from '../services/engine/scoreModel';

const requested = process.env.CARE_PRIORITY;
const active: WeightProfileName | undefined =
    requested && Object.prototype.hasOwnProperty.call(WEIGHT_PROFILES, requested) ? (requested as WeightProfileName) : undefined;

export function withCarePriority(patient: Patient): Patient {
    return active ? { ...patient, care_priority: active } : patient;
}
