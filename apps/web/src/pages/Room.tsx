import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Corner, Wordmark } from '../components/Chrome';
import Page from '../components/Page';
import Composer from '../components/room/Composer';
import MessageList from '../components/room/MessageList';
import OwnerTools from '../components/room/OwnerTools';
import RoomWeb from '../components/RoomWeb';
import Sheet from '../components/Sheet';
import { action, note, quiet } from '../components/ui';
import { useElementSize } from '../hooks/useElementSize';
import { useRoom } from '../hooks/useRoom';
import { WebLayout } from '../web/WebLayout';

type Panel = 'write' | 'read' | 'invite' | null;

// One private room, on a single screen that never scrolls: the title in the
// middle, the web of messages around it, and a short row of buttons. Writing,
// reading everything in full, and the owner's controls each open in a panel.
export default function Room() {
  const { id = '' } = useParams();
  const { status, room, messages, refresh, setRoom } = useRoom(id);
  const [stage, { width, height }] = useElementSize<HTMLElement>();
  const [panel, setPanel] = useState<Panel>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // A new room hands us its invite code through navigation state, never in the
  // address. We take it into memory and wipe it from the browser's history at
  // once, so a reload or the back button can't bring it back: it is shown once.
  const location = useLocation();
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState<string | null>(
    () => (location.state as { inviteCode?: string } | null)?.inviteCode ?? null,
  );
  useEffect(() => {
    if (location.state) void navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);
  // straight after opening a room, offer the link without being asked
  useEffect(() => {
    if (inviteCode && status === 'ready') setPanel('invite');
    // only when the room first becomes ready, not every time the code changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Clicking a thread opens the full list at that message.
  const pick = (messageId: string) => {
    setHighlighted(messageId);
    setPanel('read');
  };
  useEffect(() => {
    if (panel !== 'read' || !highlighted) return;
    // wait a frame for the panel's content to be on the page
    const frame = requestAnimationFrame(() =>
      document.getElementById(`message-${highlighted}`)?.scrollIntoView({ block: 'center' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [panel, highlighted]);

  const close = () => {
    setPanel(null);
    setHighlighted(null);
  };

  if (status === 'loading') return <Page>{null}</Page>;
  if (status !== 'ready' || !room) {
    return (
      <Page>
        <h1 className="font-hand text-display">{status === 'missing' ? 'this room isn’t available' : 'we couldn’t open this room'}</h1>
        <p className={note}>
          {status === 'missing' ? 'you may need the link from whoever invited you.' : 'check your connection and try again.'}
        </p>
        <Link to="/rooms" className={quiet}>
          your rooms
        </Link>
      </Page>
    );
  }

  const hub = WebLayout.hubFor(width, height);
  const wide = width >= 1024;
  // The landing page's title size (--text-display in index.css), in px for this width.
  const display = Math.min(44, Math.max(22.4, 16 + 0.022 * width));
  const count = messages.length;

  // The line above the actions: what the owner asked people to write, or, once
  // the room is closed, that it is closed. Nothing when there is neither.
  const caption = room.closed
    ? count > 0
      ? 'closed for now. every note can still be read.'
      : 'closed for now.'
    : room.prompt;

  // Each panel's title repeats the words that opened it.
  const ownerLabel = room.closed ? 'reopen' : 'invite someone';

  const actions = (
    <nav aria-label="this room" className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-5">
      {!room.closed && (
        <button type="button" onClick={() => setPanel('write')} className={action}>
          leave a note
        </button>
      )}
      {count > 0 && (
        <button type="button" onClick={() => setPanel('read')} className={action}>
          read in full
        </button>
      )}
      {room.isOwner && (
        <button type="button" onClick={() => setPanel('invite')} className={action}>
          {ownerLabel}
        </button>
      )}
    </nav>
  );

  return (
    <section ref={stage} className="relative h-dvh overflow-hidden">
      <RoomWeb width={width} height={height} seed={room.seed} messages={messages} onPick={pick} />

      <Wordmark className="absolute top-8 left-6 z-10" />
      <Corner className="absolute top-7 right-6 z-10" />

      {/* The title sits inside the hub at the landing page's title size, smaller
          only if its longest word wouldn't fit across. On wide screens the hub is
          an oval, so the title is kept narrower there to hold a third line clear
          of the curve; on phones it is nearly round. */}
      <h1
        className="pointer-events-none absolute z-10 line-clamp-3 -translate-x-1/2 -translate-y-1/2 text-center font-hand leading-tight"
        style={{
          left: hub.cx,
          top: hub.cy,
          width: hub.rx * (wide ? 1.5 : 1.6),
          fontSize: WebLayout.titleSize(room.title, hub, display, wide ? 1.45 : 1.55),
        }}
      >
        {room.title}
      </h1>

      {/* An empty room says so under its ring, the way the landing page captions its title. */}
      {count === 0 && !room.closed && (
        <p
          className={`pointer-events-none absolute z-10 w-max max-w-[calc(100vw-3rem)] -translate-x-1/2 text-center ${note}`}
          style={{ left: hub.cx, top: hub.cy + hub.ry + (wide ? 28 : 20) }}
        >
          no notes yet. the first one starts the web.
        </p>
      )}

      {/* The web fills the screen; below it, as at the end of the landing page,
          one line of caption and then the ways forward, all in gold. The web keeps
          84px (96px on phones) clear down here, and this block stays inside it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 grid justify-items-center gap-1 px-6 text-center lg:bottom-5">
        {caption && <p className={`line-clamp-2 max-w-xl lg:line-clamp-1 lg:max-w-2xl ${note}`}>{caption}</p>}
        {actions}
      </div>

      <Sheet open={panel === 'write'} onClose={close} title="leave a note">
        <Composer
          roomId={room.id}
          prompt={room.prompt}
          onSent={async () => {
            close();
            await refresh();
          }}
        />
      </Sheet>

      <Sheet open={panel === 'read'} onClose={close} title={count === 1 ? 'one note' : `${count} notes`}>
        <MessageList roomId={room.id} messages={messages} isOwner={room.isOwner} highlighted={highlighted} onRemoved={refresh} />
      </Sheet>

      {room.isOwner && (
        <Sheet open={panel === 'invite'} onClose={close} title={room.closed ? 'closed for now' : ownerLabel}>
          <OwnerTools room={room} inviteCode={inviteCode} onInvite={setInviteCode} onRoom={setRoom} />
        </Sheet>
      )}
    </section>
  );
}
