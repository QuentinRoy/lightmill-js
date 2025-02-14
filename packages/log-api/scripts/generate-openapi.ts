import { generateOpenApi } from '@ts-rest/open-api';
import { contract } from '../src/api.js';
import { ZodObject } from 'zod';

// Why not using ts-rest built-in client?
// Because it would force us to import zod in the client code, and I don't want that.
// I would rather create the open-api specifications, and build types from there.

const openApiDocument = generateOpenApi(
  contract,
  {
    info: {
      title: 'Logs API',
      version: '3.0.0',
      description: 'API to manage logs of experiments',
    },
  },
  {
    // It seems that ts-rest does not specify the required fields in the open-api document.
    operationMapper(operation, appRoute) {
      if (
        'body' in appRoute &&
        appRoute.body instanceof ZodObject &&
        !appRoute.body.isOptional() &&
        // It should always be the case at this point but TS won't be happy without this.
        operation.requestBody != null
      ) {
        return {
          ...operation,
          requestBody: { ...operation.requestBody, required: true },
        };
      }
      return operation;
    },
    setOperationId: true,
  },
);

console.log(JSON.stringify(openApiDocument, null, 2));
