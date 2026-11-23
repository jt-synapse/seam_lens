'use client';

import { useActionState, startTransition, type ReactNode } from 'react';
import type { Feedback } from './actions';

type Props = { action: (data: FormData) => Promise<Feedback>; children: ReactNode; className?: string };

export default function ActionForm({action,children,className}: Props) {
  const [feedback,dispatch,pending] = useActionState(
    async (_previous: Feedback,data: FormData) => action(data), {});
  return <form action={dispatch} className={className} aria-busy={pending} onSubmit={event => {
    event.preventDefault();
    // Capture the clicked status button as well as the fields. Keep edits after a validation error.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget,submitter);
    startTransition(() => dispatch(data));
  }}>
    <fieldset disabled={pending} className="admin-form-body">{children}</fieldset>
    {pending && <p role="status">Working…</p>}
    {!pending && feedback.error && <p className="admin-error" role="alert">{feedback.error}</p>}
    {!pending && feedback.message && <p className="admin-success" role="status">{feedback.message}</p>}
  </form>;
}
