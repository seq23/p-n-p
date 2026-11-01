# Schedule

Every scheduled GitHub Actions job in this repo. Times are Central (America/Chicago): each
`schedule:` entry carries `timezone: America/Chicago`, which GitHub Actions honours, so the clock
change in March and November no longer moves a job. Rebalanced 1 Nov 2026 (owner-approved weekly
schedule); see the notes below for what moved.

| Job | Workflow | When | Cron |
|---|---|---|---|
| Daily Authority Cycle | `authority-daily.yml` | every day 10:00 CT | `0 10 * * *` |
| Entity Backlink Watch | `entity-backlink-watch.yml` | Wed 10:23 CT | `23 10 * * 3` |
| Inventory Poll | `inventory-poll.yml` | `*/5 * * * *` (UTC; repeating, no fixed hour) | `*/5 * * * *` |
| Post-deploy live check | `live-check.yml` | every day 08:10 CT | `10 8 * * *` |
| Monthly Authority Audit | `monthly-audit.yml` | day 2 of every month 10:00 CT | `0 10 2 * *` |
| Bounded Self-Healing | `self-heal.yml` | Wed 11:11 CT | `11 11 * * 3` |

## Moved on 1 Nov 2026
- Monthly Authority Audit: the 1st → the 2nd, 10:00 CT (monthly jobs no longer pile onto the 1st).
- The mailer Worker's hourly reminders cron (`workers/pnp-mailer/wrangler.toml`, `0 * * * *` UTC) is
  unchanged; its 7 AM Central send is chosen in code on the Chicago clock.
