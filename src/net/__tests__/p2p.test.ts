import { describe, expect, it } from 'vitest';
import {
  P2PMatchAPI,
  type P2PDataConnection,
  type P2PPeer,
  type P2PTimings,
} from '../p2p';

/** События развозятся через микротаски — три тика хватит для пары сообщений. */
async function tick(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Мини-симулятор сигналинга PeerJS: реестр peer-id + парные соединения в памяти. */
class FakeNetwork {
  peers = new Map<string, FakePeer>();

  readonly factory = async (id?: string): Promise<P2PPeer> => new FakePeer(this, id);
}

type Handler = (...args: never[]) => void;

class FakePeer implements P2PPeer {
  private readonly handlers: Record<string, Handler[]> = {};
  private destroyed = false;
  private readonly conns: FakeConn[] = [];

  constructor(
    private readonly net: FakeNetwork,
    private readonly id?: string,
  ) {
    if (id !== undefined) {
      if (net.peers.has(id)) {
        // ошибка занятого id — макротаской: подписчики успевают навеситься
        setTimeout(() => this.emit('error', { type: 'unavailable-id' }), 0);
        return;
      }
      net.peers.set(id, this);
      // сигнал «зарегистрировались» — как настоящий PeerJS после сигналинга
      setTimeout(() => this.emit('open'), 0);
    }
  }

  on(event: 'open' | 'error' | 'connection', cb: Handler): void {
    (this.handlers[event] ??= []).push(cb);
  }

  off(event: 'error', cb: Handler): void {
    this.handlers[event] = (this.handlers[event] ?? []).filter((f) => f !== cb);
  }

  connect(targetId: string): P2PDataConnection {
    const mine = new FakeConn(this.conns);
    const theirs = new FakeConn(this.conns);
    mine.peerConn = theirs;
    theirs.peerConn = mine;
    const target = this.net.peers.get(targetId);
    if (!target || target.destroyed) {
      queueMicrotask(() => this.emit('error', { type: 'peer-unavailable' }));
      return mine;
    }
    queueMicrotask(() => {
      mine.emit('open');
      target.emit('connection', theirs);
    });
    return mine;
  }

  destroy(): void {
    if (this.id) this.net.peers.delete(this.id);
    this.destroyed = true;
    for (const c of [...this.conns]) c.close(); // уведомить и ПАРУ соединения
    this.conns.length = 0;
  }

  emit(event: 'open' | 'error' | 'connection', ...args: unknown[]): void {
    for (const cb of this.handlers[event] ?? []) (cb as (...a: unknown[]) => void)(...args);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

class FakeConn implements P2PDataConnection {
  peerConn: FakeConn | null = null;
  private readonly handlers: Record<string, Handler[]> = {};

  constructor(registry: FakeConn[]) {
    registry.push(this);
  }

  on(event: 'open' | 'data' | 'close' | 'error', cb: Handler): void {
    (this.handlers[event] ??= []).push(cb);
  }

  send(data: unknown): void {
    queueMicrotask(() => this.peerConn?.emit('data', data));
  }

  close(): void {
    this.peerConn?.emit('close');
  }

  emit(event: 'open' | 'data' | 'close' | 'error', ...args: unknown[]): void {
    for (const cb of this.handlers[event] ?? []) (cb as (...a: unknown[]) => void)(...args);
  }
}

const TIMINGS: P2PTimings = { connectMs: 250, hubWaitMs: 400, resultMs: 400 };

describe('P2PMatchAPI (фейковая сеть)', () => {
  it('комната: хост + гость по коду, общий сид и встречный обмен именами', async () => {
    const net = new FakeNetwork();
    const host = new P2PMatchAPI(net.factory, TIMINGS);
    const guest = new P2PMatchAPI(net.factory, TIMINGS);

    const room = await host.createRoom();
    expect(room.matched).toBe(false);
    expect(room.code).toHaveLength(5);

    const joined = await guest.joinRoom(room.code);
    expect(joined.matched).toBe(true);

    await tick();
    const pollHost = await host.pollMatch(room.matchId);
    const pollGuest = await guest.pollMatch(joined.matchId);
    expect(pollHost.matched).toBe(true);
    expect(pollGuest.matched).toBe(true);
    expect(pollHost.seed).toBe(pollGuest.seed);
    expect(pollHost.seed).toBeGreaterThan(0);
    expect(pollHost.startAt).toBeGreaterThan(Date.now());
    // имена заполнены с обеих сторон (в jsdom-тесте sessionStorage общий — имена совпадают)
    expect(pollHost.opponentName).toBeTruthy();
    expect(pollGuest.opponentName).toBeTruthy();
  });

  it('комната не найдена: joinRoom отвергает', async () => {
    const net = new FakeNetwork();
    const guest = new P2PMatchAPI(net.factory, TIMINGS);
    await expect(guest.joinRoom('ZZZZ9')).rejects.toThrow();
  });

  it('быстрый матч: двое на одном слоте — общий сид', async () => {
    const net = new FakeNetwork();
    const a = new P2PMatchAPI(net.factory, TIMINGS);
    const b = new P2PMatchAPI(net.factory, TIMINGS);

    const qa = await a.quickMatch();
    expect(qa.matched).toBe(false);
    await tick();
    // a занял слот и ждёт
    const pollA = await a.pollMatch(qa.matchId);
    expect(pollA.matched).toBe(false);

    const qb = await b.quickMatch();
    await tick();
    const pollB = await b.pollMatch(qb.matchId);
    expect(pollB.matched).toBe(true);
    const pollA2 = await a.pollMatch(qa.matchId);
    expect(pollA2.matched).toBe(true);
    expect(pollA2.seed).toBe(pollB.seed);
  });

  it('занятый дуэлью хаб отвечает busy: третий игрок не мешает паре', async () => {
    const net = new FakeNetwork();
    const a = new P2PMatchAPI(net.factory, TIMINGS);
    const b = new P2PMatchAPI(net.factory, TIMINGS);
    const c = new P2PMatchAPI(net.factory, TIMINGS);

    await a.quickMatch();
    await tick();
    await b.quickMatch();
    await tick();
    const pollA = await a.pollMatch('x');
    const pollB = await b.pollMatch('x');
    expect(pollA.matched).toBe(true);
    expect(pollB.matched).toBe(true);

    // третий игрок: слот 0 занят дуэлью пары (busy) → уходит на следующий свободный слот
    const qc = await c.quickMatch();
    await tick(2);
    const pollC = await c.pollMatch(qc.matchId);
    expect(pollC.matched).toBe(false); // продолжает искать, пару A-B не тронул
    const pollA2 = await a.pollMatch('x');
    expect(pollA2.matched).toBe(true);
    c.cancel(qc.matchId); // остановить фоновый поиск перед завершением теста
  });

  it('обмен результатами: победитель синхронен, дельты зеркальны', async () => {
    const net = new FakeNetwork();
    const host = new P2PMatchAPI(net.factory, TIMINGS);
    const guest = new P2PMatchAPI(net.factory, TIMINGS);
    const room = await host.createRoom();
    await guest.joinRoom(room.code);
    await tick();

    const [outHost, outGuest] = await Promise.all([
      host.reportResult(room.matchId, 120),
      guest.reportResult(room.matchId, 90),
    ]);
    expect(outHost.winner).toBe('me');
    expect(outHost.opponentScore).toBe(90);
    expect(outGuest.winner).toBe('opponent');
    expect(outGuest.opponentScore).toBe(120);
    expect(outHost.ratingDelta).toBe(8);
    expect(outGuest.ratingDelta).toBe(-6);
  });

  it('живой счёт: notifyProgress виден сопернику до финиша', async () => {
    const net = new FakeNetwork();
    const host = new P2PMatchAPI(net.factory, TIMINGS);
    const guest = new P2PMatchAPI(net.factory, TIMINGS);
    const room = await host.createRoom();
    await guest.joinRoom(room.code);
    await tick();

    host.notifyProgress(room.matchId, 30);
    await tick();
    const poll = await guest.pollMatch(room.matchId);
    expect(poll.opponentScore).toBe(30);
    // ещё не финишировал — победителя нет
    expect(poll.winner).toBeNull();
  });

  it('cancel(): комната закрыта, peer-id освобождён', async () => {
    const net = new FakeNetwork();
    const host = new P2PMatchAPI(net.factory, TIMINGS);
    const room = await host.createRoom();
    expect(net.peers.size).toBeGreaterThan(0);
    host.cancel(room.matchId);
    expect(net.peers.size).toBe(0);
  });

  it('соперник исчез до результата: оставшийся получает победу', async () => {
    const net = new FakeNetwork();
    const host = new P2PMatchAPI(net.factory, TIMINGS);
    const guest = new P2PMatchAPI(net.factory, TIMINGS);
    const room = await host.createRoom();
    await guest.joinRoom(room.code);
    await tick();

    // гость «умирает»: его peer уничтожен → соединение закрыто
    guest.cancel(room.matchId);
    await tick();
    const out = await host.reportResult(room.matchId, 77);
    expect(out.winner).toBe('me');
    expect(out.ratingDelta).toBe(8);
  });
});
