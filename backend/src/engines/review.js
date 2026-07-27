export const REVIEW_TRANSITIONS = Object.freeze({
  open: { start: 'in_review', close: 'closed' },
  in_review: { approve: 'approved', reject: 'rejected', close: 'closed' },
  rejected: { resubmit: 'in_review', close: 'closed' },
  approved: { reopen: 'in_review' },
  closed: { reopen: 'open' }
});

export function transitionReview(currentStatus, event) {
  const normalizedStatus = currentStatus || 'open';
  const normalizedEvent = String(event || '').toLowerCase();
  const next = REVIEW_TRANSITIONS[normalizedStatus]?.[normalizedEvent];
  if (!next) return { ok: false, error: `Transition ${normalizedEvent || '(empty)'} is not allowed from ${normalizedStatus}` };
  return { ok: true, from: normalizedStatus, to: next, event: normalizedEvent };
}
