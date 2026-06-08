<!-- GENERATED from the-flow.json — do not hand-edit. -->
# Flight plan — add-extension-skill

```mermaid
flowchart TD
  classDef done fill:#E8F5E9,stroke:#43A047,color:#1B5E20;
  classDef wip fill:#FFF3E0,stroke:#FB8C00,color:#E65100;
  classDef known fill:#ECEFF1,stroke:#607D8B,color:#263238;
  classDef assumed fill:#FAFAFA,stroke:#BDBDBD,color:#616161,stroke-dasharray:4 3;
  classDef said fill:#E3F2FD,stroke:#1E88E5,color:#0D47A1;
  classDef companion fill:#F3E5F5,stroke:#8E24AA,color:#4A148C;

  spec["Spec"]:::done
  ws2["Workshop - scaffold template set"]:::done
  plan["Plan (READY, 7/7 gates)"]:::done

  subgraph crc["companion: code-review-companion (completed)"]
    phase1["Implementation - 23 tasks DONE"]:::done
  end
  class crc companion

  merge["Merge"]:::known

  spec --> plan --> phase1 --> merge
  spec -.-> ws2 -.-> plan

  say_spec>"user: cli command to template out the empty extension ... context aware"]:::said
  say_impl>"user: implement with companion ... then try it in a temp location ... then minih agent"]:::said
  say_spec -.- spec
  say_impl -.- phase1
```

**Legend**: done | known (designed) | assumed | user words | companion-wrapped phase

**Now**: build done — 191 tests, companion review clean, built-bin + minih e2e PASS. **Next**: merge (/plan-8) when ready.
