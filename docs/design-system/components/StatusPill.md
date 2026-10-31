# StatusPill

A short colored label for the status of a dashboard or display, always with words.

| Status | Class |
| --- | --- |
| Unpublished changes | `hd-pill--warn hd-pill--dot` |
| Connected | `hd-pill--ok hd-pill--dot` |
| Connection lost | `hd-pill--warn hd-pill--dot` |
| Waiting for a dashboard | `hd-pill hd-pill--dot` |
| Older version | `hd-pill--warn` |
| N tiles not found | `hd-pill--danger` |

Use `--dot` for live connection states, and leave it off for facts about versions. The words carry the meaning; color only supports them.
