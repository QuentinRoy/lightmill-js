import { vi } from 'vitest';
import { fetch, Request, Response } from 'cross-fetch';

vi.stubGlobal('fetch', fetch);
vi.stubGlobal('Request', Request);
vi.stubGlobal('Response', Response);
