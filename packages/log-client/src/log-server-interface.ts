import type {
  Body as ApiBody,
  Response as ApiResponse,
} from '@lightmill/log-api';
import { post, patch, del, get } from './fetch.js';

type RunEndpointConfig = {
  apiRoot?: string;
  runName: string;
  experimentName: string;
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
  let body: ApiBody<'put', '/sessions/current'> = { role, password };
  let r = await post(`${apiRoot}/sessions`, { body, credentials: 'include' });
  return r as ApiResponse<'put', '/sessions/current'>;
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
  runName,
  experimentName,
}: GetRunInfoParameter) {
  let r = await get(`${apiRoot}/experiments/${experimentName}/runs/${runName}`);
  return r as ApiResponse<'get', '/experiments/:experimentName/runs/:runName'>;
}

type UpdateRunStatusParameter = RunEndpointConfig & {
  runStatus: 'completed' | 'canceled' | 'interrupted';
};
export async function updateRunStatus({
  apiRoot = '',
  runName,
  experimentName,
  runStatus,
}: UpdateRunStatusParameter) {
  let body: ApiBody<'patch', '/experiments/:experimentName/runs/:runName'> = {
    runStatus,
  };
  let r = await patch(
    `${apiRoot}/experiments/${experimentName}/runs/${runName}`,
    {
      body,
      credentials: 'include',
      // This request is sometimes sent from a browser tab that is about to be
      // closed. We want to make sure that the request is sent before the tab is
      // closed.
      keepalive: true,
    },
  );
  return r as ApiResponse<
    'patch',
    '/experiments/:experimentName/runs/:runName'
  >;
}

type ResumeRunParameter = RunEndpointConfig & { resumeFrom: number };
export async function resumeRun({
  apiRoot = '',
  runName,
  experimentName,
  resumeFrom,
}: ResumeRunParameter) {
  let body: ApiBody<'patch', '/experiments/:experimentName/runs/:runName'> = {
    resumeFrom,
    runStatus: 'running',
  };
  let r = await patch(
    `${apiRoot}/experiments/${experimentName}/runs/${runName}`,
    {
      body,
      credentials: 'include',
    },
  );
  return r as ApiResponse<
    'patch',
    '/experiments/:experimentName/runs/:runName'
  >;
}

type PostLogParameter = RunEndpointConfig &
  ApiBody<'post', '/experiments/:experimentName/runs/:runName/logs'>;
export async function postLog({
  apiRoot = '',
  runName,
  experimentName,
  ...body
}: PostLogParameter) {
  let r = await post(
    `${apiRoot}/experiments/${experimentName}/runs/${runName}/logs`,
    {
      body,
      credentials: 'include',
      keepalive: true,
    },
  );
  return r as ApiResponse<
    'post',
    '/experiments/:experimentName/runs/:runName/logs'
  >;
}
