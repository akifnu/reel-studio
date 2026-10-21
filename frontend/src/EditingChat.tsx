import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Loader2, Check, Trash2 } from 'lucide-react';
import { api } from './api';
import { controlSummary } from './utils';
import { browserMode } from './features';
import type { Changes, Project, Proposal, Reel } from './types';
type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposal?: Proposal;
  applied?: boolean;
};
export default function EditingChat({
  project,
  reel,
  disabled,
  onApply,
  draft,
}: {
  project: Project;
  reel: Reel;
  disabled: boolean;
  draft: Changes;
  onApply: (changes: Changes) => Promise<void>;
}) {
  const key = `reel-studio-chat:${project.id}:${reel.id}`;
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState(''),
    [asking, setAsking] = useState(false),
    [applying, setApplying] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(messages.slice(-40)));
    } catch {}
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, key]);
  async function send(text = input) {
    if (!text.trim() || asking) return;
    setInput('');
    setAsking(true);
    const context = messages
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text, changes: m.proposal?.changes }));
    setMessages((old) => [...old, { id: crypto.randomUUID(), role: 'user', text }]);
    try {
      const p = await api<Proposal>(`/projects/${project.id}/propose`, 'POST', {
        reel_id: reel.id,
        generation: project.generation,
        text,
        ...(browserMode ? { context, draft } : {}),
      });
      setMessages((old) => [
        ...old,
        { id: crypto.randomUUID(), role: 'assistant', text: p.explanation, proposal: p },
      ]);
    } catch (e) {
      setMessages((old) => [
        ...old,
        { id: crypto.randomUUID(), role: 'assistant', text: (e as Error).message },
      ]);
    } finally {
      setAsking(false);
    }
  }
  return (
    <section className="editing-chat" aria-label="Editing chat">
      <div className="chat-heading">
        <MessageCircle size={22} />
        <div>
          <h3>Your editing assistant</h3>
          <p>
            {browserMode ? 'Local · free · works with this reel' : 'Review changes before applying'}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Clear editing chat"
          onClick={() => setMessages([])}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <p className="field-hint">
        {browserMode
          ? 'Ask about the reference, or request an edit. Supported commands run locally; this is not a general AI model.'
          : 'Request an edit using your configured proposal provider.'}{' '}
        Every change gets a new storyboard review.
      </p>
      <div
        className="chat-messages"
        role="log"
        aria-label="Editing conversation"
        aria-live="polite"
      >
        {!messages.length && (
          <p className="chat-empty">
            Try “warmer and faster”, “remove the caption box”, or “what did you detect in my
            reference?”
          </p>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`chat-message ${m.role}`}>
            <small>{m.role === 'user' ? 'You' : 'Editing assistant'}</small>
            <p>{m.text}</p>
            {m.proposal && Object.keys(m.proposal.changes).length > 0 && (
              <>
                <ul>
                  {controlSummary(m.proposal.changes).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <button
                  className="button orange full"
                  disabled={
                    disabled ||
                    !!applying ||
                    m.applied ||
                    m.proposal.generation !== project.generation
                  }
                  onClick={async () => {
                    setApplying(m.id);
                    try {
                      await onApply(m.proposal!.changes);
                      setMessages((old) =>
                        old.map((x) => (x.id === m.id ? { ...x, applied: true } : x)),
                      );
                    } catch (e) {
                      setMessages((old) => [
                        ...old,
                        { id: crypto.randomUUID(), role: 'assistant', text: (e as Error).message },
                      ]);
                    } finally {
                      setApplying('');
                    }
                  }}
                >
                  {applying === m.id ? <Loader2 className="spin" size={15} /> : <Check size={15} />}{' '}
                  {m.applied
                    ? 'Applied to storyboard'
                    : m.proposal.generation !== project.generation
                      ? 'Edit changed — ask again'
                      : 'Apply & update storyboard'}
                </button>
              </>
            )}
          </article>
        ))}
        {asking && (
          <p role="status">
            <Loader2 className="spin" size={14} /> Reading your edit…
          </p>
        )}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="editing-message">
          Message editing assistant
        </label>
        <textarea
          id="editing-message"
          rows={3}
          maxLength={2000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What would you like to change?"
          disabled={asking}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="button dark full" type="submit" disabled={!input.trim() || asking}>
          <Send size={15} />
          Send message
        </button>
      </form>
      <div className="prompt-chips">
        {[
          'What did you detect?',
          'Match reference colour',
          'Match reference pacing',
          'Warmer and faster',
          'Remove the caption box',
        ].map((s) => (
          <button key={s} disabled={asking} onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
