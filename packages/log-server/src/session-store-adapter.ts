import koaSession from 'koa-generic-session';
import { Store } from './store.js';

export class SessionStoreAdapter {
  #mainStore: Store;

  constructor(mainStore: Store) {
    this.#mainStore = mainStore;
  }

  async get(key: string) {
    let session = await this.#mainStore.getSession(key);
    if (!session) return;
    if (session.expiresAt != null && session.expiresAt < new Date()) {
      await this.#mainStore.deleteSession(key);
      return;
    }
    return {
      ...session,
      cookie: {
        ...session.cookie,
        expires: session.cookie.expires
          ? new Date(session.cookie.expires as string)
          : undefined,
      },
    };
  }

  async set(sessionId: string, session: koaSession.Session, ttl: number) {
    await this.#mainStore.setSession({
      id: sessionId,
      runId: session.run?.id,
      role: session.role,
      cookie: {
        ...session.cookie,
        expires: session.cookie.expires?.toISOString() ?? null,
      },
      expiresAt: ttl ? new Date(Date.now() + ttl) : undefined,
    });
  }

  async destroy(key: string) {
    await this.#mainStore.deleteSession(key);
  }
}
