# LightMill

LightMill helps you build web experiments, such as HCI or psychology studies, and collect their data on your own server. You write each part of the experiment as a task, list the tasks in a timeline, and LightMill shows them in turn, sends what participants do to a log server, and exports it as CSV.

## How it fits together

```txt
participant's browser                                      your server
timeline ──▶ TimelinePlayer ──▶ logger ───── HTTPS ─────▶ log server ──▶ SQLite ──▶ CSV
(tasks)      (shows tasks)      (sends logs)
```

- An **experiment** is a study, created once on the server.
- A **run** is one participant going through the experiment once. Each run has a name, usually derived from the participant, and is unique within its experiment.
- A **timeline** is the sequence of tasks of a run. A **task** is a plain object with a `type`, such as `{ type: 'trial', size: 'large' }`, and your app has one component per task type.
- A **log** records something that happened during a run, such as an answer and its reaction time. Logs have a `type` and values, and are numbered in order.
- A run is `running` once started, then `completed`, `canceled`, or `interrupted`. A running or interrupted run can be resumed: the participant continues after the last log the server holds.
- The **host** is the researcher's account on the server. It can read every log. Participants only see their own runs.

## Packages

| You want to                                       | Use                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Show tasks with React                             | [`@lightmill/react-experiment`](packages/react-experiment/README.md)     |
| Show tasks without React                          | [`@lightmill/runner`](packages/runner/README.md)                         |
| Send logs from the browser                        | [`@lightmill/log-client`](packages/log-client/README.md)                 |
| Store logs and export them                        | [`@lightmill/log-server`](packages/log-server/README.md)                 |
| Order conditions across participants              | [`@lightmill/counterbalancing`](packages/counterbalancing/README.md)     |
| Turn a Touchstone design into timelines           | [`@lightmill/convert-touchstone`](packages/convert-touchstone/README.md) |
| Write another client or server for the log server | [`@lightmill/log-api`](packages/log-api/README.md)                       |

A typical React experiment uses `react-experiment` and `log-client` in the app, and `log-server` on the server. Each package also works on its own: `TimelinePlayer` doesn't need a server, and `log-client` works with any interface.

## A taste

A task component reads its task, logs what happened, and says when it is done:

```tsx
import {
  TimelinePlayer,
  useLogger,
  useTask,
} from '@lightmill/react-experiment';

function Question() {
  const { task, onTaskCompleted } = useTask('question');
  const log = useLogger('answer');
  return (
    <button
      onClick={() => {
        log({ taskId: task.id, answer: 'yes' });
        onTaskCompleted();
      }}
    >
      Yes
    </button>
  );
}

const timeline = [
  { type: 'question', id: 'q1' },
  { type: 'question', id: 'q2' },
];

// `logger` comes from @lightmill/log-client.
<TimelinePlayer
  timeline={timeline}
  onLog={(log) => logger.addLog(log)}
  elements={{ tasks: { question: <Question /> } }}
/>;
```

The [getting started](docs/guides/getting-started.md) guide builds a complete experiment around this.

## Guides

1. [Getting started](docs/guides/getting-started.md): build a complete experiment, from the first task to the CSV file.
2. [Deploying](docs/guides/deploying.md): put the app and the log server online.
3. [Resuming runs](docs/guides/resuming-runs.md): let participants continue after a reload.
4. [Exporting data](docs/guides/exporting-data.md): get the logs out, and what the CSV contains.

`@lightmill/log-client` supports Chrome and Edge 85, Firefox 90, and Safari 15 or later. `@lightmill/react-experiment` needs React 19.2 or later. The log server needs Node.js 24.12 or later.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
