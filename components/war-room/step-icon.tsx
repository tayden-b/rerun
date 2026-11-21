import { CheckIcon, CircleDashedIcon, CircleXIcon, LoaderCircleIcon } from 'lucide-react';
import type { StepState } from '@/lib/ui/incident-view';

export function traceStatus(state: StepState): 'running' | 'error' | 'pending' | undefined {
  return state === 'done' ? undefined : state;
}

export function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') return <LoaderCircleIcon className="text-brand animate-spin" />;
  if (state === 'error') return <CircleXIcon />;
  if (state === 'pending') return <CircleDashedIcon className="opacity-50" />;
  return <CheckIcon className="text-success" />;
}
