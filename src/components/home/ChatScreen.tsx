import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Trash2 } from 'lucide-react';
import type { ChatMessage, League } from '../../types';
import { BackHeader } from '../layout/BackHeader';
import { TeamLogo } from '../common/TeamLogo';
import { EmptyState } from '../common/EmptyState';
import { ConfirmSheet } from '../common/ConfirmSheet';

const SLIDE_MS = 260;
/** A touch has to start this close to the left edge to count as the back swipe. */
const EDGE_PX = 24;

/**
 * League chat as its own screen, opened from the speech bubble in the League Home header (backlog C6).
 *
 * It used to be a tab inside the Activity feed, so the bubble expanded the Activity card and switched
 * it to Chat, and chat lived in two places. Now it slides in over League Home from the right and
 * leaves the same way: Back, or a swipe from the left edge. League Home stays mounted underneath, so
 * coming back keeps its scroll position and leaves the Activity card as it was.
 *
 * Messages read like any messaging app: oldest at the top, newest at the bottom beside the box.
 */
export function ChatScreen({
  league,
  chat,
  onClose,
  onSend,
  onDelete,
  onSeen,
}: {
  league: League;
  chat: ChatMessage[];
  onClose: () => void;
  /** Resolves false when the send failed, which keeps the typed message in the box. */
  onSend: (message: string) => Promise<boolean>;
  onDelete?: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Called whenever there are messages on screen, so the header bubble's count clears. */
  onSeen: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startT: number; lastX: number } | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setDragX(null);
    setShown(false);
    window.setTimeout(onClose, SLIDE_MS);
  };

  // The phone's keyboard shrinks the visual viewport but not a fixed element, so the box would sit
  // under it. Lift the screen's bottom edge by however much the keyboard covers.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    if (chat.length > 0) onSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.length]);

  // Newest at the bottom: open there, and follow new messages down.
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, keyboard]);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // The text only leaves the box once it has actually been posted (see chat, Oct 2026).
  async function send() {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      if (await onSend(message)) setText('');
      else setError('Message not sent. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  const ordered = [...chat].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const offset = dragX ?? 0;

  return (
    <div
      className="fixed inset-0 z-[55] flex justify-center"
      style={{ bottom: keyboard }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (t.clientX > EDGE_PX) return;
        drag.current = { startX: t.clientX, startT: e.timeStamp, lastX: t.clientX };
      }}
      onTouchMove={(e) => {
        if (!drag.current) return;
        const x = e.touches[0].clientX;
        drag.current.lastX = x;
        setDragX(Math.max(0, x - drag.current.startX));
      }}
      onTouchEnd={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const dx = d.lastX - d.startX;
        const speed = dx / Math.max(1, e.timeStamp - d.startT);
        if (dx > window.innerWidth / 3 || speed > 0.5) close();
        else setDragX(null);
      }}
    >
      <div
        role="dialog"
        aria-label="League chat"
        className="w-full max-w-md h-full flex flex-col bg-bg shadow-2xl"
        style={{
          transform: shown ? `translateX(${offset}px)` : 'translateX(100%)',
          transition: dragX != null ? 'none' : `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
        }}
      >
        <div className="shrink-0 bg-bg-raised" style={{ height: 'env(safe-area-inset-top)' }} />
        <BackHeader title="Chat" onBack={close} />

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3">
          {ordered.length === 0 ? (
            <EmptyState icon={<MessageCircle size={36} strokeWidth={1.5} />} title="No messages yet" subtitle="Say something to the rest of the league." />
          ) : (
            // Few messages sit at the bottom next to the box, the way a messaging app reads.
            <div className="min-h-full flex flex-col justify-end space-y-3">
              {ordered.map((m) => (
                <ChatRow key={m.id} league={league} item={m} onDelete={onDelete ? () => setPendingDelete(m.id) : undefined} />
              ))}
            </div>
          )}
        </div>

        <div
          className="shrink-0 border-t border-border bg-bg-raised px-3 pt-2 space-y-1"
          style={{ paddingBottom: keyboard > 0 ? '0.5rem' : 'calc(0.5rem + env(safe-area-inset-bottom))' }}
        >
          {error && <p className="text-[11px] text-loss px-1">{error}</p>}
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              placeholder="Message the league…"
              maxLength={500}
              enterKeyHint="send"
              className="flex-1 min-w-0 bg-bg-card border border-border rounded-lg px-3 py-2 text-sm"
            />
            <button
              disabled={!text.trim() || sending}
              onClick={() => void send()}
              aria-label="Send message"
              className="btn-soft-primary text-sm font-semibold px-3 rounded-lg disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {pendingDelete && onDelete && (
        <ConfirmSheet
          title="Delete this message?"
          description="This can't be undone."
          confirmLabel="Delete"
          confirmingLabel="Deleting…"
          onConfirm={() => onDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/** One message: the sender's logo, name and time, then the text. Only your own can be deleted. */
function ChatRow({ league, item, onDelete }: { league: League; item: ChatMessage; onDelete?: () => void }) {
  const team = league.teams.find((t) => t.id === item.teamId);
  return (
    <div className="flex items-start gap-2">
      {team ? <TeamLogo team={team} size="sm" /> : <span className="w-6 h-6 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <p className="text-xs font-semibold truncate">{team?.teamName ?? 'Former member'}</p>
          <p className="text-[10px] text-text-muted shrink-0">
            {new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        <p className="text-sm break-words">{item.message}</p>
      </div>
      {team?.isUser && onDelete && (
        <button onClick={onDelete} className="text-text-muted hover:text-loss shrink-0 mt-0.5" aria-label="Delete message">
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
