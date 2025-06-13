import { Store as SessionStore, type SessionData } from 'express-session';
import { vi } from 'vitest';

export class MockSessionStore extends SessionStore {
  data: Map<string, SessionData> = new Map();

  ids = vi.fn((cb: (ids: string[]) => void) => {
    cb(Array.from(this.data.keys()));
  });

  get = vi.fn(
    (sid: string, cb: (err?: Error | null, data?: SessionData) => void) => {
      if (this.data.has(sid)) {
        cb(null, this.data.get(sid));
      } else {
        cb();
      }
    },
  );

  set = vi.fn((sid: string, data: SessionData, cb: (err?: Error) => void) => {
    this.data.set(sid, data);
    cb();
  });

  destroy = vi.fn((sid: string, cb: (err?: Error) => void) => {
    this.data.delete(sid);
    cb();
  });

  mockGetData = (data: SessionData['data']) => {
    this.get.mockImplementation((_sid, cb) => {
      cb(null, { data, cookie: { originalMaxAge: 0 } });
    });
  };
}
