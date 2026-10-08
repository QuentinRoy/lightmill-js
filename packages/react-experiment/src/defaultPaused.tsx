import * as React from 'react';
import { useLogDelivery } from './useLogDelivery.js';

const dataUrlPrefix = 'data:application/json;charset=utf-8,';

/**
 * A link to download the logs the server has not stored, or nothing when none
 * is held. A plain anchor: building it has no side effect and it works over
 * http.
 */
export function DownloadLogsLink(): React.JSX.Element | null {
  const { inFlightLogs } = useLogDelivery();
  if (inFlightLogs.length === 0) return null;
  return (
    <a
      download="logs.json"
      href={
        dataUrlPrefix +
        encodeURIComponent(JSON.stringify(inFlightLogs, null, 2))
      }
    >
      Download the logs that were not saved
    </a>
  );
}

export function DefaultPaused(): React.JSX.Element {
  const { retry } = useLogDelivery();
  return (
    <div>
      <p>
        Your progress could not be saved. Check your connection, then retry.
      </p>
      <DownloadLogsLink />
      <button onClick={() => void retry()}>Retry</button>
    </div>
  );
}
