import { Session } from 'koa-generic-session';
import { Store } from './store.js';
import { JsonObject } from './utils.js';

export class SessionStoreAdapter {
  #mainStore: Store;

  constructor(mainStore: Store) {
    this.#mainStore = mainStore;
  }

  async get(key: string): Promise<Required<Session> | undefined> {
    let session = await this.#mainStore.getSession(key);
    if (!session) return;
    let { cookie, expiresAt, ...logging } = session;
    if (expiresAt != null && expiresAt < new Date()) {
      await this.#mainStore.deleteSession(key);
      return;
    }
    cookie = cookie as JsonObject;
    return {
      logging,
      cookie: {
        ...cookie,
        expires: cookie.expires
          ? new Date(cookie.expires as string)
          : undefined,
      },
    };
  }

  async set(sessionId: string, session: Required<Session>, ttl: number) {
    await this.#mainStore.setSession({
      id: sessionId,
      runId: session.logging.runId,
      role: session.logging.role,
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
