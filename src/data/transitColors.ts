import type { VehicleState } from '@/types/transit';

export const VEHICLE_STATE_COLORS = {
  'on-time': '#151515',
  delayed: '#d71920',
  early: '#147d64',
  unknown: '#86857f',
} satisfies Record<VehicleState, string>;