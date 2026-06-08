<!-- GENERATED from the-flow.json — do not hand-edit. -->
# Flight plan — add-extension-skill

```mermaid
flowchart TD
  classDef done fill:#E8F5E9,stroke:#43A047,color:#1B5E20;
  classDef wip fill:#FFF3E0,stroke:#FB8C00,color:#E65100;
  classDef known fill:#ECEFF1,stroke:#607D8B,color:#263238;
  classDef assumed fill:#FAFAFA,stroke:#BDBDBD,color:#616161,stroke-dasharray:4 3;
  classDef said fill:#E3F2FD,stroke:#1E88E5,color:#0D47A1;

  spec["Spec"]:::done
  ws1["Decision - keep skill thin (no workshop)"]:::done
  ws2["Workshop - scaffold template set + layout"]:::done
  plan["Plan (READY, 7/7 gates)"]:::done
  phase1["Implementation (20 tasks, TDD)"]:::known
  merge["Merge"]:::assumed

  spec --> plan --> phase1 --> merge
  spec -.-> ws1 -.-> plan
  spec -.-> ws2 -.-> plan

  say_spec>"user: cli command to template out the empty extension ... context aware"]:::said
  say_ws2>"user: what will be scaffolded and where and where the templates live"]:::said
  say_plan>"user: yeah next"]:::said
  say_spec -.- spec
  say_ws2 -.- ws2
  say_plan -.- plan
```

**Legend**: done | in progress | known (designed) | assumed (speculative) | user words

**Now**: plan READY (validate-v2 running). **Next**: implement (/plan-6)
