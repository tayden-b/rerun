'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckIcon, GitPullRequestIcon, MessageSquareIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Textarea } from '@/components/ui/textarea';
import type { PullRequest } from '@/src/shared/types';

type Decision = 'idle' | 'approved' | 'changes_requested';

/** Body sent to both Wave 2 routes: `{}` or `{ "comment": "<trimmed text>" }`. */
export function decisionBody(comment: string): { comment?: string } {
  const trimmed = comment.trim();
  return trimmed ? { comment: trimmed } : {};
}

async function postDecision(incidentId: string, action: 'approve' | 'request-changes', comment: string) {
  const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decisionBody(comment)),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? `The ${action} endpoint is not available yet (404).`
        : `The ${action} request failed (${response.status}).`,
    );
  }
}

export function ConfirmationBar({
  incidentId,
  pr,
  canDecide,
}: {
  incidentId: string;
  pr?: PullRequest;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision>('idle');
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const busy = decision !== 'idle';

  async function decide(action: 'approve' | 'request-changes') {
    const optimistic: Decision = action === 'approve' ? 'approved' : 'changes_requested';
    setDecision(optimistic);
    try {
      await postDecision(incidentId, action, action === 'request-changes' ? comment : '');
      setCommenting(false);
      setComment('');
      toast.success(action === 'approve' ? 'Approved. Merging the PR.' : 'Changes requested.');
      router.refresh();
    } catch (error) {
      setDecision('idle');
      toast.error(action === 'approve' ? 'Approval not recorded' : 'Request not recorded', {
        description: (error as Error).message,
      });
    }
  }

  return (
    <div
      data-testid="confirmation"
      className="bg-background/90 sticky bottom-0 z-10 border-t backdrop-blur supports-backdrop-filter:bg-background/75"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-3 px-6 py-3">
        {commenting && (
          <Textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What should change? Rerun adds this to the fix agent's next attempt."
            className="min-h-16 text-sm"
            aria-label="Request changes comment"
          />
        )}
        <Item size="sm" className="px-0 py-0">
          <ItemMedia variant="icon">
            <GitPullRequestIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="font-normal">
              {decision === 'approved'
                ? 'Approved — merging'
                : decision === 'changes_requested'
                  ? 'Changes requested'
                  : pr
                    ? `Merge PR #${pr.number}${pr.draft ? ' (draft)' : ''}`
                    : 'No pull request yet'}
            </ItemTitle>
            <ItemDescription className="font-mono text-xs">
              {pr ? pr.branch : 'Rerun is still working on this incident.'}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            {commenting ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setCommenting(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="outline" size="sm" onClick={() => decide('request-changes')} disabled={busy}>
                  Send request
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCommenting(true)}
                disabled={!canDecide || busy}
                data-testid="request-changes"
              >
                <MessageSquareIcon />
                Request changes
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => decide('approve')}
              disabled={!canDecide || busy}
              data-testid="approve"
            >
              <CheckIcon />
              {decision === 'approved' ? 'Approved' : 'Approve and merge'}
            </Button>
          </ItemActions>
        </Item>
      </div>
    </div>
  );
}
