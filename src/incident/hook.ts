import type { ApprovalSignal } from './pipeline';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `resumeHook()` (workflow/api) for the approval hook. The workflow registers the hook just before the
 * incident becomes `awaiting_approval`, so a short retry covers the gap; false when nothing is waiting.
 */
export async function resumeApprovalHook(
  token: string,
  signal: ApprovalSignal,
  attempts = 20,
): Promise<boolean> {
  const [{ resumeHook }, { HookNotFoundError }] = await Promise.all([
    import('workflow/api'),
    import('workflow/errors'),
  ]);
  for (let i = 0; i < attempts; i++) {
    try {
      await resumeHook<ApprovalSignal>(token, signal);
      return true;
    } catch (error) {
      if (!HookNotFoundError.is(error)) throw error;
      await sleep(250);
    }
  }
  return false;
}
