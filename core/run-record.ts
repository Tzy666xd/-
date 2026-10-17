import type { HandKind } from './hands.ts';
export type DecisionKind = 'start' | 'hire' | 'sell' | 'raise' | 'event' | 'item' | 'contract' | 'story';
export interface RunDecision { kind: DecisionKind; night: number; stage: number; hand: number; text: string }
export interface RunStats { plays: number; discards: number; bestHand: number; bestStage:number; totalScore:number; handUse: Partial<Record<HandKind, number>>; partial: boolean }
export const newRunStats = (): RunStats => ({ plays:0, discards:0, bestHand:0, bestStage:0, totalScore:0, handUse:{}, partial:false });
