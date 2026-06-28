# Original ask — telemetry-otel-standard
**Captured**: 2026-06-26  ·  **By**: /the-flow

> we need a new flow, this one is to standardise our telemetry to OTEL standard so we can ingest it in to upstream systems. we will still store local like now. consider this: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/fileexporter/README.md and its associated code, and these samples. we could somehow store our information like this? perhaps our segments each form some kind of otel compat record?
>
> ```json
> {
>   "resourceLogs": [
>     {
>       "resource": { "attributes": [ { "key": "service.name", "value": { "stringValue": "payment-processor" } } ] },
>       "scopeLogs": [
>         {
>           "logRecords": [
>             {
>               "timeUnixNano": "1782382860300000000",
>               "severityText": "WARN",
>               "body": { "stringValue": "Transaction timeout reached" },
>               "attributes": [ { "key": "tx.id", "value": { "stringValue": "tx_99214" } } ]
>             }
>           ]
>         }
>       ]
>     }
>   ]
> }
> ```
>
> and
>
> ```json
> {
>   "resourceMetrics": [
>     {
>       "resource": { "attributes": [ { "key": "service.name", "value": { "stringValue": "auth-service" } } ] },
>       "scopeMetrics": [
>         {
>           "metrics": [
>             {
>               "name": "http.server.active_requests",
>               "sum": {
>                 "dataPoints": [ { "timeUnixNano": "1782382860000000000", "asInt": "42" } ]
>               }
>             }
>           ]
>         }
>       ]
>     }
>   ]
> }
> ```
