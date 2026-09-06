# Security

## Reporting

Report a vulnerability privately through GitHub's private vulnerability reporting: the
**Security** tab of this repository, then **Report a vulnerability**. It opens a draft advisory
that only the maintainer can read. Please do not open a public issue or pull request for it.

Say what is affected, how to reproduce it, and what you think the impact is. You will get an
acknowledgement, then a fix or an explanation, and credit in the advisory if you want it.

## Scope

ParamRig is a local development tool: the workbench and its service run on the developer's own
machine, and `@paramrig/web` is a development-only integration that does nothing unless a
workbench is framing the page. Reports about the pairing between the two, the files the service
writes into a project's `.paramrig` directory, or the contents of the published package are
especially welcome. There is no hosted service, account, or telemetry to report on.

## Supported versions

The latest commit on `main` and the latest published version of `@paramrig/web`.
