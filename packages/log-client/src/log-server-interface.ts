import type {
  Body as ApiBody,
  Response as ApiResponse,
} from '@lightmill/log-api';
import { post, patch, del, get } from './fetch.js';

type RunEndpointConfig = {
  apiRoot?: string;
  runId: string;
  experimentId: string;
};

type CreateNewSessionParameter = {
  apiRoot?: string;
  role: 'participant' | 'host';
  password?: string;
};
export async function createNewSession({
  apiRoot = '',
  role,
  password,
}: CreateNewSessionParameter) {
  let body: ApiBody<'post', '/sessions'> = { role, password };
  let r = await post(`${apiRoot}/sessions`, { body, credentials: 'include' });
  return r as ApiResponse<'post', '/sessions'>;
}

type GetSessionInfoParameter = { apiRoot?: string };
export async function getSessionInfo({
  apiRoot = '',
}: GetSessionInfoParameter) {
  let r = await get(`${apiRoot}/sessions/current`, {
    credentials: 'include',
  });
  return r as ApiResponse<'get', '/sessions/current'>;
}

type DeleteSessionParameter = { apiRoot?: string };
export async function deleteSession({ apiRoot = '' }: DeleteSessionParameter) {
  let r = await del(`${apiRoot}/sessions/current`, {
    credentials: 'include',
  });
  return r as ApiResponse<'delete', '/sessions/current'>;
}

type CreateNewRunParameter = { apiRoot?: string } & ApiBody<'post', '/runs'>;
export async function createNewRun({
  apiRoot = '',
  ...body
}: CreateNewRunParameter) {
  let r = await post(`${apiRoot}/runs`, { body, credentials: 'include' });
  return r as ApiResponse<'post', '/runs'>;
}

type GetRunInfoParameter = RunEndpointConfig;
export async function getRunInfo({
  apiRoot = '',
  runId,
  experimentId,
}: GetRunInfoParameter) {
  let r = await get(`${apiRoot}/experiments/${experimentId}/runs/${runId}`);
  return r as ApiResponse<'get', '/experiments/:experimentId/runs/:runId'>;
}

type UpdateRunStatusParameter = RunEndpointConfig & {
  status: 'completed' | 'canceled';
};
export async function updateRunStatus({
  apiRoot = '',
  runId,
  experimentId,
  status,
}: UpdateRunStatusParameter) {
  let body: ApiBody<'patch', '/experiments/:experimentId/runs/:runId'> = {
    status,
  };
  let r = await patch(`${apiRoot}/experiments/${experimentId}/runs/${runId}`, {
    body,
    credentials: 'include',
    // This request is sometimes sent from a browser tab that is about to be
    // closed. We want to make sure that the request is sent before the tab is
    // closed.
    keepalive: true,
  });
  return r as ApiResponse<'patch', '/experiments/:experimentId/runs/:runId'>;
}

type ResumeRunParameter = RunEndpointConfig & { resumeFrom: number };
export async function resumeRun({
  apiRoot = '',
  runId,
  experimentId,
  resumeFrom,
}: ResumeRunParameter) {
  let body: ApiBody<'patch', '/experiments/:experimentId/runs/:runId'> = {
    resumeFrom,
  };
  let r = await patch(`${apiRoot}/experiments/${experimentId}/runs/${runId}`, {
    body,
    credentials: 'include',
  });
  return r as ApiResponse<'patch', '/experiments/:experimentId/runs/:runId'>;
}

type PostLogParameter = RunEndpointConfig &
  ApiBody<'post', '/experiments/:experimentId/runs/:runId/logs'>;
export async function postLog({
  apiRoot = '',
  runId,
  experimentId,
  ...body
}: PostLogParameter) {
  let r = await post(
    `${apiRoot}/experiments/${experimentId}/runs/${runId}/logs`,
    {
      body,
      credentials: 'include',
      keepalive: true,
    },
  );
  return r as ApiResponse<
    'post',
    '/experiments/:experimentId/runs/:runId/logs'
  >;
}
