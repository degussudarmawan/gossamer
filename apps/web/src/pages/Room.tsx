import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Corner, Wordmark } from '../components/Chrome';
import Page from '../components/Page';
import Composer from '../components/room/Composer';
import MessageList from '../components/room/MessageList';
import OwnerTools from '../components/room/OwnerTools';
import RoomWeb from '../components/RoomWeb';
import Sheet from '../components/Sheet';
import { note, primary, quiet } from '../components/ui';
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
        <h1 className="font-hand text-display">{status === 'missing' ? 'this room isn’t available' : 'something went wrong'}</h1>
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
  const count = messages.length;

  return (
    <section ref={stage} className="relative h-dvh overflow-hidden">
      <RoomWeb width={width} height={height} seed={room.seed} messages={messages} onPick={pick} />

      <Wordmark className="absolute top-8 left-6 z-10" />
      <Corner className="absolute top-7 right-6 z-10" />

      {/* The title sits inside the hub ring, sized so no word has to break. */}
      <h1
        className="pointer-events-none absolute line-clamp-3 -translate-x-1/2 -translate-y-1/2 text-center font-hand leading-snug"
        // the landing page's title size, unless a long word needs it smaller to fit the ring
        style={{
          left: hub.cx,
          top: hub.cy,
          width: hub.rx * 1.5,
          fontSize: WebLayout.titleSize(room.title, hub, width >= 1024 ? 44 : 22),
        }}
      >
        {room.title}
      </h1>

      <nav className="absolute inset-x-0 bottom-7 z-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-6">
        {room.closed ? (
          <p className={note}>closed</p>
        ) : (
          <button type="button" onClick={() => setPanel('write')} className={`${primary} bg-(--cloth)`}>
            write
          </button>
        )}
        {count > 0 && (
          <button type="button" onClick={() => setPanel('read')} className={quiet}>
            read {count}
          </button>
        )}
        {room.isOwner && (
          <button type="button" onClick={() => setPanel('invite')} className={quiet}>
            invite
          </button>
        )}
      </nav>

      <Sheet open={panel === 'write'} onClose={close} title="write">
        <Composer
          roomId={room.id}
          prompt={room.prompt}
          onSent={async () => {
            close();
            await refresh();
          }}
        />
      </Sheet>

      <Sheet open={panel === 'read'} onClose={close} title={count === 1 ? '1 message' : `${count} messages`}>
        <MessageList roomId={room.id} messages={messages} isOwner={room.isOwner} highlighted={highlighted} onRemoved={refresh} />
      </Sheet>

      {room.isOwner && (
        <Sheet open={panel === 'invite'} onClose={close} title="your room">
          <OwnerTools room={room} inviteCode={inviteCode} onInvite={setInviteCode} onRoom={setRoom} />
        </Sheet>
      )}
    </section>
  );
}
