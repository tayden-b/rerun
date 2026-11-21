import { CheckIcon, CircleDashedIcon, CircleXIcon, LoaderCircleIcon } from 'lucide-react';
import type { StepState } from '@/lib/ui/incident-view';

export function traceStatus(state: StepState): 'running' | 'error' | 'pending' | undefined {
  return state === 'done' ? undefined : state;
}

export function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') return <LoaderCircleIcon className="text-brand motion-safe:animate-spin" />;
  if (state === 'error') return <CircleXIcon />;
  if (state === 'pending') return <CircleDashedIcon />;
  return <CheckIcon className="text-success" />;
}
