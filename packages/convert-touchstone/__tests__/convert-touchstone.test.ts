import { createReadStream, ReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import * as url from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import convert from '../src/convert-touchstone.js';

const dirname = url.fileURLToPath(new URL('.', import.meta.url));
const fixturePath = path.join(
  dirname,
  '__fixtures__',
  'convert-touchstone.test.xml',
);

describe('convert', () => {
  let fixture: ReadStream;

  beforeEach(async () => {
    fixture = createReadStream(fixturePath);
  });

  it('accepts a string as input', async () => {
    let content = await readFile(fixturePath, 'utf-8');
    await expect(convert(content)).resolves.toMatchSnapshot();
  });

  it('accepts a readable stream as input', async () => {
    await expect(convert(fixture)).resolves.toMatchSnapshot();
  });

  it('pres, posts, and trials options can be specified as strings', async () => {
    await expect(
      convert(fixture, {
        trial: 'mock-trial',
        preRun: 'mock-pre-run',
        postRun: 'mock-post-run',
        preBlock: 'mock-pre-block',
        postBlock: 'mock-post-block',
      }),
    ).resolves.toMatchSnapshot();
  });

  it('pres, posts, and trials options can be specified as functions', async () => {
    let i = -1;
    const getId = () => {
      i += 1;
      return `${i}`;
    };
    const trial = vi.fn(() => ({
      type: 'mock-trial',
      id: getId(),
      data: 'data',
    }));
    const preRun = vi.fn(() => ({
      type: 'mock-pre-run',
      id: getId(),
      data: 'data',
    }));
    const postRun = vi.fn(() => ({
      type: 'mock-post-run',
      id: getId(),
      data: 'data',
    }));
    const preBlock = vi.fn(() => ({
      type: 'mock-pre-block',
      id: getId(),
      data: 'data',
    }));
    const postBlock = vi.fn(() => ({
      type: 'mock-post-block',
      id: getId(),
      data: 'data',
    }));
    await expect(
      convert(fixture, { preRun, postRun, preBlock, postBlock, trial }),
    ).resolves.toMatchSnapshot('convert');
    expect(trial).toMatchSnapshot('trial');
    expect(preRun).toMatchSnapshot('preRun');
    expect(postRun).toMatchSnapshot('postRun');
    expect(preBlock).toMatchSnapshot('preBlock');
    expect(postBlock).toMatchSnapshot('postBlock');
  });

  it('pres, posts, and trials options can be specified as strings', async () => {
    await expect(
      convert(fixture, {
        trial: 'mock-trial',
        preRun: 'mock-pre-run',
        postRun: 'mock-post-run',
        preBlock: 'mock-pre-block',
        postBlock: 'mock-post-block',
      }),
    ).resolves.toMatchSnapshot();
  });

  it('pres, posts, and trials can be specified as arrays of objects', async () => {
    await expect(
      convert(fixture, {
        trial: [{ type: 'trial-1' }, { type: 'trial-2' }],
        preRun: [{ type: 'pre-run-1' }, { type: 'pre-run-2' }],
        postRun: [{ type: 'post-run-1' }, { type: 'post-run-2' }],
        preBlock: [{ type: 'pre-block-1' }, { type: 'pre-block-2' }],
        postBlock: [{ type: 'post-block-1' }, { type: 'post-block-2' }],
      }),
    ).resolves.toMatchSnapshot();
  });

  it('pres, posts, and trials options can be specified as arrays of strings', async () => {
    await expect(
      convert(fixture, {
        trial: ['trial-1', 'trial-2'],
        preRun: ['pre-run-1', 'pre-run-2'],
        postRun: ['post-run-1', 'post-run-2'],
        preBlock: ['pre-block-1', 'pre-block-2'],
        postBlock: ['post-block-1', 'post-block-2'],
      }),
    ).resolves.toMatchSnapshot();
  });

  it('fails if it is provided with an empty string', async () => {
    await expect(() => convert('')).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: No experiment tag found]`,
    );
  });

  it('fails if it is provided with an empty readable', async () => {
    let noOpReadable = new Readable({
      read() {
        setImmediate(() => {
          this.push(null);
        });
      },
    });

    await expect(() =>
      convert(noOpReadable),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: No experiment tag found]`,
    );
  });
});
