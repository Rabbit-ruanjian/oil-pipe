const GRAVITY_ACCELERATION = 9.80665;
const PASCALS_PER_MPA = 1_000_000;
const MM2_PER_M2 = 1_000_000;

function isFinitePositiveNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function convertPressureMpaToHeadMeters(
  pressureMpa: number | null | undefined,
  densityKgPerM3: number | null | undefined,
): number | undefined {
  if (!isFinitePositiveNumber(pressureMpa) || !isFinitePositiveNumber(densityKgPerM3)) {
    return undefined;
  }

  return Number(((pressureMpa * PASCALS_PER_MPA) / (densityKgPerM3 * GRAVITY_ACCELERATION)).toFixed(2));
}

export function convertViscosityMm2PerSecToM2PerSec(viscosityMm2PerSec: number | null | undefined): number | undefined {
  if (!isFinitePositiveNumber(viscosityMm2PerSec)) {
    return undefined;
  }

  return Number((viscosityMm2PerSec / MM2_PER_M2).toFixed(8));
}
