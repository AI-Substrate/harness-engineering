<!-- foundations: first-principles#16, patterns-that-work#P17-P19 -->

# Backpressure Check

Backpressure Check is an advisory, LLM-assisted survey over the current work scope and this repository's deterministic sensor inventory.

It is **not** a core harness command and it is **not** deterministic proof by itself. The proof comes from the sensors the harness exposes or the sensors the check recommends adding.

## Sensor inventory

The local sensor inventory lives in:

```txt
harness/cli/commands.json
```

Look for configured or unconfigured deterministic sensor slots such as:

- `build`
- `test`
- `lint`
- `typecheck`
- `health`
- `smoke`
- `arch`
- `security`
- `schema`
- `observe`

Missing key means unsupported or not declared. Empty string means the slot is known but unconfigured. Non-empty string means the command to run.

## How tools use this

The tools backpressure skill reads the current scope/spec plus this sensor inventory and asks:

1. What failure modes would make the scoped work green but wrong?
2. Which deterministic sensors already prove those risks?
3. Which sensors are missing and worth adding?
4. Which remaining checks are legitimately inferential or human-judgement?

The result is advisory. It should inform the plan or harness improvement work; it should not become a blocking gate by itself.

## Encoding rule

If Backpressure Check finds a missing proof surface, encode the missing proof as a sensor, command, check, fixture, diagnostic, schema, smoke path, or evidence capture.

Do not add a generic `backpressure` command. Add the sensor that would prove the risk.
