import { atomicMediaType, mediaType } from '@lightmill/log-api/vocabulary';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createClient, listen } from './__fixtures__/test-utils.ts';

const experiments = {
  data: [{ type: 'experiments', id: '1', attributes: { name: 'experiment' } }],
};
// The API requires experiment names to be non-empty.
const invalidExperiments = {
  data: [{ type: 'experiments', id: '1', attributes: { name: '' } }],
};

async function clientFor(
  path: string,
  response: express.RequestHandler,
  options?: { basePath: string },
) {
  return createClient(await listen(express().all(path, response)), options);
}

describe('createClient', () => {
  it('rejects a response that does not match the API', async () => {
    const client = await clientFor('/experiments', (_request, response) => {
      response.type(mediaType).send(invalidExperiments);
    });
    await expect(client.get('/experiments')).rejects.toThrow(
      'GET /experiments answered 200 with a body that does not match the API: /data/0/attributes/name: ',
    );
  });

  it('rejects a response the API does not declare', async () => {
    const client = await clientFor('/experiments', (_request, response) => {
      response.status(201).type(mediaType).send(experiments);
    });
    await expect(client.get('/experiments')).rejects.toThrow(
      `GET /experiments answered 201 ${mediaType}, which the API does not declare`,
    );
  });

  it('accepts a server error on any route', async () => {
    const client = await clientFor('/experiments', (_request, response) => {
      response
        .status(503)
        .type(mediaType)
        .send({
          errors: [
            { status: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' },
          ],
        });
    });
    await client.get('/experiments').expect(503);
  });

  it('accepts a response with media type parameters the API declares', async () => {
    const client = await clientFor('/operations', (_request, response) => {
      response
        .type(atomicMediaType)
        .send({ 'atomic:results': [{ data: { type: 'logs', id: '1' } }] });
    });
    await client.post('/operations').expect(200);
  });

  it('accepts a csv export', async () => {
    const client = await clientFor('/logs', (_request, response) => {
      response.type('text/csv').send('type,number\nlog,1\n');
    });
    await client.get('/logs').expect(200);
  });

  it('checks the API under its base path', async () => {
    const client = await clientFor(
      '/api/experiments',
      (_request, response) => {
        response.type(mediaType).send(invalidExperiments);
      },
      { basePath: '/api' },
    );
    await expect(client.get('/api/experiments')).rejects.toThrow(
      'GET /api/experiments answered 200 with a body that does not match the API: /data/0/attributes/name: ',
    );
  });

  it('ignores responses outside the base path', async () => {
    const client = await clientFor(
      '/experiments',
      (_request, response) => {
        response.status(201).send('not the API');
      },
      { basePath: '/api' },
    );
    await client.get('/experiments').expect(201);
  });
});
