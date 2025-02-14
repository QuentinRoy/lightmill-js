import { generateOpenApi } from '@ts-rest/open-api';
import { contract } from '../src/api.js';

// Why not using ts-rest built-in client?
// Because it would force us to import zod in the client code, and I don't want that.
// I would rather create the open-api specifications, and build types from there.

const openApiDocument = generateOpenApi(contract, {
  info: {
    title: 'Logs API',
    version: '3.0.0',
    description: 'API to manage logs of experiments',
  },
});

console.log(JSON.stringify(openApiDocument, null, 2));
