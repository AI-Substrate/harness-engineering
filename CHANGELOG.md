# Changelog

## Unreleased

### ⚠ BREAKING CHANGES

* **cli:** the Node runtime floor (`engines.node` `>=22`) is now **enforced at runtime** — `harness doctor` adds a `node-runtime` layer that degrades with an upgrade `next_action` on Node `<22` (previously the floor was advisory only). Launching a `.cmd` shim on Windows requires a patched Node — a bare `.cmd` spawn EINVALs on `<20.12.2` — and the CLI standardises on `>=22` (plan 031 / workshop 001).

### Features

* **builder:** select a historical already-integrated commit with `compose --import --already-integrated --integration-sha <ref>`, retaining the current checkout and original worker SHAs. The selected commit must descend from the seal and precede the current artifact; later PM edits reach verification with ownership warnings.
* **builder:** bind existing native peers with `dispatch --adopt-peer` and observe committed deliveries with `compose --import --already-integrated`, retaining original ownership and SHAs without spawning or replaying source ([#206](https://github.com/AI-Substrate/harness-engineering/pull/206)). Sealed inputs are verified against original Git blobs rather than mutable PM files; factual progress remains separate from product intent.
* **exec:** opt into exact-byte stdout with `stdoutEncoding: 'base64'`; the result explicitly marks encoded output while default text behavior stays unchanged.
* **cli:** portable verb I/O (plan 031) — new optional capabilities on the verb contract so extensions run cross-platform with **no** `bash`/coreutil shell-outs: `ctx.fsWrite` (write / mkdir / rename / CWE-59-confined copy), `ctx.fs.realpath`, `ctx.clock.sleep`, and `ctx.background.spawnDetached` (detached fire-and-forget worker; reuses the core `.cmd` resolver, never a bare `.cmd` spawn).

## [0.15.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.14.0...v0.15.0) (2026-09-09)


### Features

* **builder:** architecture-led team lifecycle for dogfooding ([7194a37](https://github.com/AI-Substrate/harness-engineering/commit/7194a379ca0edab26fda9ba445ce7d2fcce32b28))
* **builder:** bind already-integrated work at a historical commit ([aa18514](https://github.com/AI-Substrate/harness-engineering/commit/aa185146c01b07bdb4e7e9ff872673a64fce363c))
* **builder:** bind existing peers and integrated work without replay ([6e5ff58](https://github.com/AI-Substrate/harness-engineering/commit/6e5ff58acc8407b6e675a46799bea537ae0f79c8))
* **builder:** bind existing peers and integrated work without replay ([a45a5fa](https://github.com/AI-Substrate/harness-engineering/commit/a45a5fa9bbbee3461174ede8e04b8690aa50567e))
* **builder:** bind historical integration points without checkout ([94b50ca](https://github.com/AI-Substrate/harness-engineering/commit/94b50ca60039fee87346bb9765e95ee4e3318caf))
* **builder:** finish warning-first delivery and on-track guidance ([2c00ef9](https://github.com/AI-Substrate/harness-engineering/commit/2c00ef930f8e0fa65501d4afd8589234e734734f))
* **builder:** make delivery maps advisory and add on-track inspection ([6ff4f57](https://github.com/AI-Substrate/harness-engineering/commit/6ff4f571d5df3190421d4fef0153614ce16d9832))
* **builder:** make PM composition ownership advisory ([1a63983](https://github.com/AI-Substrate/harness-engineering/commit/1a639835ed498792caefb830198c28ff32a14771))
* **builder:** replace acknowledgement ceremony with advisory self-check ([495cbaf](https://github.com/AI-Substrate/harness-engineering/commit/495cbaf79db5f847bce80a259fac8083dee0a0cc))
* **builder:** replace startup handshake with advisory self-check ([fe3a2de](https://github.com/AI-Substrate/harness-engineering/commit/fe3a2de0b752bb0641913656c6c40ce361e91e0d))
* **builder:** report PM composition map deviations as warnings ([46f237b](https://github.com/AI-Substrate/harness-engineering/commit/46f237be8c92678e2ae75b0f656d6a2f0eeb5cb0))
* **builder:** ship architecture-led team workflow for dogfooding ([44c9dd3](https://github.com/AI-Substrate/harness-engineering/commit/44c9dd3ca98b816d09b1a316f6034413eb1f8b1c))


### Bug Fixes

* **builder:** a unit reservation resolves its parent allocation from the workspace locator ([45ac8b2](https://github.com/AI-Substrate/harness-engineering/commit/45ac8b2b98e550852f2250809ac80872629c1762))
* **builder:** a unit reservation resolves its parent allocation from the workspace locator ([de7fee4](https://github.com/AI-Substrate/harness-engineering/commit/de7fee4c07e9e249e8b76f90110667f4ecd29ca3))
* **builder:** bind adopted plan locators without changing ownership ([cc26c32](https://github.com/AI-Substrate/harness-engineering/commit/cc26c32152c5a847316b2bcab5cac6f06d94fd65))
* **builder:** decouple dependency proof from maps and preserve failure warnings ([448df8b](https://github.com/AI-Substrate/harness-engineering/commit/448df8b24303cc365e1e2b01f7ac742d2d14f5c3))
* **builder:** dispatch accepts a plan-root HEAD that descends from the sealed source ([cd533bb](https://github.com/AI-Substrate/harness-engineering/commit/cd533bb4d671c426815128fbc4d5fa8ea36e75ec))
* **builder:** dispatch accepts a plan-root HEAD that descends from the sealed source ([cf05657](https://github.com/AI-Substrate/harness-engineering/commit/cf05657fae5af3bf0b62db70d4a193a767991d20))
* **builder:** isolate preservation receipt schemas from copied evidence ([82a481e](https://github.com/AI-Substrate/harness-engineering/commit/82a481e9a482bac03b80c88d726e051d91ecdc74))
* **builder:** keep harness records outside composition source proof ([90fda4f](https://github.com/AI-Substrate/harness-engineering/commit/90fda4f0f5964c22712af592a6a0afc1500acd72))
* **builder:** preserve composition proof across harness records ([bc83f51](https://github.com/AI-Substrate/harness-engineering/commit/bc83f517542994ea02ab693798d488f64d7ce4e3))
* **builder:** read large preservation receipts with a matching bound ([67117a8](https://github.com/AI-Substrate/harness-engineering/commit/67117a8e7004b86214c85e44335b040f6a667365))
* **builder:** stage current packet schema beside legacy consumers ([52b7225](https://github.com/AI-Substrate/harness-engineering/commit/52b72257483dafe6f8eb0856cdb80b8af1fcaf88))
* **builder:** support large preservation receipts without rewriting evidence ([1ef1425](https://github.com/AI-Substrate/harness-engineering/commit/1ef1425b882bf8daca95fe139828cd347654b638))
* **cli:** envelopes over 64 KiB are no longer truncated when stdout is a pipe ([b4c45d2](https://github.com/AI-Substrate/harness-engineering/commit/b4c45d2e7264dc515bcc115e53a451e3acccbd55))
* **cli:** envelopes over 64 KiB are no longer truncated when stdout is a pipe ([5eeed5d](https://github.com/AI-Substrate/harness-engineering/commit/5eeed5dc31e188208435065e7fec6d8d73d0f11a))
* **convo:** resolve session identity from the harness's own env; never discard an unresolvable identity silently ([#190](https://github.com/AI-Substrate/harness-engineering/issues/190)) ([7401708](https://github.com/AI-Substrate/harness-engineering/commit/74017086f14c917d2add3784332314ddbdfc1c95))
* **flow-eval:** admit packaged Builder schemas in consumer preparation ([4ca45e7](https://github.com/AI-Substrate/harness-engineering/commit/4ca45e7406e803c19de38e513125fbd180ccbfa9))
* **flow-eval:** prepare packaged Builder schemas and preserve local evidence ([39094cd](https://github.com/AI-Substrate/harness-engineering/commit/39094cdeee23519be8eaab5cdd9476418b53c2d0))
* **flow-eval:** preserve local run evidence and runtime links safely ([8a5cb71](https://github.com/AI-Substrate/harness-engineering/commit/8a5cb719e04a7473960b00c070de994d15c560a0))
* **release:** allow git and remote fetches when installing for publish ([8eeb1bb](https://github.com/AI-Substrate/harness-engineering/commit/8eeb1bb1db5fa193035709a2d4bb22abc5b3a0cd))
* **release:** allow git dependencies in the publish and canary installs ([fad228b](https://github.com/AI-Substrate/harness-engineering/commit/fad228b7391f788d1ca1cf7275713666474413ff))
* **release:** also allow remote tarballs while preparing the dd git dependency ([c57af4c](https://github.com/AI-Substrate/harness-engineering/commit/c57af4c31a676ba37058ea28d1f1c70269b07775))
* **settings:** a linked worktree with no tracked settings inherits the MAIN checkout's ([#192](https://github.com/AI-Substrate/harness-engineering/issues/192)) ([7933f5f](https://github.com/AI-Substrate/harness-engineering/commit/7933f5fbfe7b207012510993e17388d7740214f8))

## [0.14.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.13.0...v0.14.0) (2026-08-30)


### Features

* **dd:** consume @ai-substrate/dd as a package, delete the in-repo fork (plan 080) ([#154](https://github.com/AI-Substrate/harness-engineering/issues/154)) ([197540e](https://github.com/AI-Substrate/harness-engineering/commit/197540eebffc46d946b7ba6ea982377d98b58060))
* **dd:** dd-native builder — plans as deterministic documents, gates driven by document state (plan 071) ([#95](https://github.com/AI-Substrate/harness-engineering/issues/95)) ([13679de](https://github.com/AI-Substrate/harness-engineering/commit/13679dee31cc25b6adde87115de1fc8d53dc3b97))
* **dd:** Deterministic Documents — validated data docs, generated views, graph map, and a runnable reference (plan 065) ([#87](https://github.com/AI-Substrate/harness-engineering/issues/87)) ([d537ad3](https://github.com/AI-Substrate/harness-engineering/commit/d537ad3333dd024ca1dc64fb7449ebd13cc73716))
* **ddocs:** bump @ai-substrate/dd to de01b77a and migrate the dd→ddocs rename ([#184](https://github.com/AI-Substrate/harness-engineering/issues/184)) ([d7fbea1](https://github.com/AI-Substrate/harness-engineering/commit/d7fbea13ee66bce75f7b3fa3ea662597314fd7a9))
* **hooks:** resolve the interpreter at fire time via a shipped wrapper ([#172](https://github.com/AI-Substrate/harness-engineering/issues/172)) ([3e4b148](https://github.com/AI-Substrate/harness-engineering/commit/3e4b148aeb18de137fea14579c57aa0efd1e6a61))
* **plan:** `harness plan ready` — a three-valued readiness gate that refuses to judge an empty plan ([1aef9d9](https://github.com/AI-Substrate/harness-engineering/commit/1aef9d9c99e6f618f749cfc6651609e7778a730c))
* **record:** always warn when an extension is skipped, never hide it ([#86](https://github.com/AI-Substrate/harness-engineering/issues/86)) ([ad4882a](https://github.com/AI-Substrate/harness-engineering/commit/ad4882a072a5dc7fcffa0f4f21914263446db17b))
* **settings+convo:** settings machinery and flowspace conversation sync (plan 091) ([#185](https://github.com/AI-Substrate/harness-engineering/issues/185)) ([478129d](https://github.com/AI-Substrate/harness-engineering/commit/478129d9c87341cc13ccb49f8a7547b800a503ef))
* **skills:** add eng-harness-in-a-box — zero-dependency harness loop ([7227d25](https://github.com/AI-Substrate/harness-engineering/commit/7227d254a92531c0d88a78c3d14986e7c5887324))
* **skills:** post-flight close-out stage, plan archiving, assets/ layout, opt-in domains ([#90](https://github.com/AI-Substrate/harness-engineering/issues/90)) ([963eae5](https://github.com/AI-Substrate/harness-engineering/commit/963eae5348d25bebb9bfeda5dd6b0f6bebb8c0ea))
* **telemetry:** capture liveness + orphan-lane reconciliation — a stalled capture can no longer pass as healthy (plan 070) ([#93](https://github.com/AI-Substrate/harness-engineering/issues/93)) ([f78957e](https://github.com/AI-Substrate/harness-engineering/commit/f78957e38ea335ff7c7f12a121db76e687a26ce3))
* **telemetry:** cursor + vscode file-write evidence (plan 066) ([#88](https://github.com/AI-Substrate/harness-engineering/issues/88)) ([895644a](https://github.com/AI-Substrate/harness-engineering/commit/895644a59531ecdf9dda563d89b9a9a8c7c886f6))
* **telemetry:** discipline signal capture — control facet + self-observed checks verdicts (plan 069) ([#92](https://github.com/AI-Substrate/harness-engineering/issues/92)) ([d8e0cfe](https://github.com/AI-Substrate/harness-engineering/commit/d8e0cfea752a4131dc5db1307dbfe75e065cc5ee))
* **telemetry:** git-ai becomes the collector — harness capture off by default, pinned+verified install (plan 073) ([#104](https://github.com/AI-Substrate/harness-engineering/issues/104)) ([7b39b2d](https://github.com/AI-Substrate/harness-engineering/commit/7b39b2d539ecb9fbd575188409a75fc91506e7e4))


### Bug Fixes

* **arch-check:** refuse an empty cruise instead of reporting ok ([#164](https://github.com/AI-Substrate/harness-engineering/issues/164)) ([a1e528e](https://github.com/AI-Substrate/harness-engineering/commit/a1e528e72762253007f9b0b3fd1089cb597431bb))
* **collector:** a Windows named pipe is an ingress, never a buffer (plan 075) ([#107](https://github.com/AI-Substrate/harness-engineering/issues/107)) ([5dae6e9](https://github.com/AI-Substrate/harness-engineering/commit/5dae6e9c8c106628f5fb5680aef8c5af52ec5938))
* **collector:** drop the unsatisfiable release_host pin — the install path never worked ([#124](https://github.com/AI-Substrate/harness-engineering/issues/124)) ([#125](https://github.com/AI-Substrate/harness-engineering/issues/125)) ([f4944a0](https://github.com/AI-Substrate/harness-engineering/commit/f4944a0d530ab134bf55903bf77435f7e309861f))
* **convo:** drop --pij from resolved dispatch and detect dead-on-arrival children ([#188](https://github.com/AI-Substrate/harness-engineering/issues/188)) ([ef895a3](https://github.com/AI-Substrate/harness-engineering/commit/ef895a3c05bd3a4f03a7ba4ff940f770c97d3596))
* **dd,doctor:** --path is broken on Windows however the user spells it ([#108](https://github.com/AI-Substrate/harness-engineering/issues/108)) ([#116](https://github.com/AI-Substrate/harness-engineering/issues/116)) ([cfa501a](https://github.com/AI-Substrate/harness-engineering/commit/cfa501a6b6fc195479b42bbfc0f14332ae9c0b57))
* **dd,flow:** one address per fact, one remedy mapper per finding ([#105](https://github.com/AI-Substrate/harness-engineering/issues/105)) ([4902fef](https://github.com/AI-Substrate/harness-engineering/commit/4902fef7ddd12846934719be79874840f79b8160))
* **dd:** a drive-rooted address file part is absolute, not relative ([#108](https://github.com/AI-Substrate/harness-engineering/issues/108) D7) ([#133](https://github.com/AI-Substrate/harness-engineering/issues/133)) ([3d1e469](https://github.com/AI-Substrate/harness-engineering/commit/3d1e469261929e598b4f5633fc5068731ed92727))
* **extensions:** a name collision with a core verb skips the extension instead of bricking the CLI ([#187](https://github.com/AI-Substrate/harness-engineering/issues/187)) ([c2050ae](https://github.com/AI-Substrate/harness-engineering/commit/c2050aef61f47949b49e65826f7c11f54c26c807))
* **hooks:** check the INTERPRETER too, refuse paths that will not survive, and attribute every journal record ([#171](https://github.com/AI-Substrate/harness-engineering/issues/171)) ([0fb45e3](https://github.com/AI-Substrate/harness-engineering/commit/0fb45e3bb92aa2f23e1248d5388659febaedd087))
* **hooks:** hook wrappers must fail OPEN when the CLI dies after node starts ([#181](https://github.com/AI-Substrate/harness-engineering/issues/181)) ([93e7c80](https://github.com/AI-Substrate/harness-engineering/commit/93e7c80329daeb5e202b35d8c8d9085913b91679))
* **hooks:** the Windows `command` must START with a native executable (plan 088) ([#177](https://github.com/AI-Substrate/harness-engineering/issues/177)) ([9d3ea8e](https://github.com/AI-Substrate/harness-engineering/commit/9d3ea8e419ef5ef73a89e54458c731b6d6b7b8ee))
* **instructions:** converge commit guidance on the CommitMode union (plan 076) ([#112](https://github.com/AI-Substrate/harness-engineering/issues/112)) ([1636094](https://github.com/AI-Substrate/harness-engineering/commit/163609493015ac11023e2a39b3bdf10c097c58b7))
* **markdown-lint:** the unexamined finding offers the branch, not one repair ([#150](https://github.com/AI-Substrate/harness-engineering/issues/150)) ([277003c](https://github.com/AI-Substrate/harness-engineering/commit/277003c910a232746fd06f8d0baafced4a436609))
* **telemetry:** Cursor Write/StrReplace reported a silent 0% agent share (FX009) ([#103](https://github.com/AI-Substrate/harness-engineering/issues/103)) ([bf58bea](https://github.com/AI-Substrate/harness-engineering/commit/bf58bea9f5bdcc3147d43c26314284a7e7a042cd))
* **telemetry:** FX002 + FX003 + FX004 + the read pin at the floor — an unavailability is a state ([f50a0e8](https://github.com/AI-Substrate/harness-engineering/commit/f50a0e88a50fd14779529ac8c80b01b712a40bde))
* **telemetry:** FX007 — the published reader could not read its own repo's telemetry ([#101](https://github.com/AI-Substrate/harness-engineering/issues/101)) ([e756d09](https://github.com/AI-Substrate/harness-engineering/commit/e756d0910e9219b0864c637ac5950f3c79b92619))
* **telemetry:** FX007 residue — the OTLP path had its own no-space grammar ([#102](https://github.com/AI-Substrate/harness-engineering/issues/102)) ([d08f494](https://github.com/AI-Substrate/harness-engineering/commit/d08f4942d28b7e5181d5845a56a63b0cbb1d3402))
* **telemetry:** read-path honesty — degrade-never-throw, honest time, path-only authorship, pre-commit capture (plan 068) ([#91](https://github.com/AI-Substrate/harness-engineering/issues/91)) ([2984bf9](https://github.com/AI-Substrate/harness-engineering/commit/2984bf980fc43c92ac6ddb2eb1608523fff09300))
* **windows:** 107 failing tests to 0, measured on a real Windows VM (plan 083) ([#165](https://github.com/AI-Substrate/harness-engineering/issues/165)) ([cfbf741](https://github.com/AI-Substrate/harness-engineering/commit/cfbf741587675bb34f3dda9d1ca1faad4ec99717))


### Performance Improvements

* **telemetry:** stop scanning the whole Copilot log dir on every command ([#100](https://github.com/AI-Substrate/harness-engineering/issues/100)) ([6651683](https://github.com/AI-Substrate/harness-engineering/commit/66516836c49eaa921535701d2cd6b724944ca78f))
* **telemetry:** sync in milliseconds, not minutes (plan 067) ([#89](https://github.com/AI-Substrate/harness-engineering/issues/89)) ([64609be](https://github.com/AI-Substrate/harness-engineering/commit/64609bebbf99755b37a45a1fb4c4671166ab857a))
* **tests:** run the suite fast by default, and gate any ref without touching your tree ([#155](https://github.com/AI-Substrate/harness-engineering/issues/155)) ([1da78a4](https://github.com/AI-Substrate/harness-engineering/commit/1da78a41656f14bdc94d31d19757d193133566fa))

## [0.13.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.12.0...v0.13.0) (2026-07-29)


### Features

* add remote telemetry retrieval ([#73](https://github.com/AI-Substrate/harness-engineering/issues/73)) ([562a225](https://github.com/AI-Substrate/harness-engineering/commit/562a2255fc8c470aabd068ee6198d41e2d45ead8))
* **builder:** add The Ask to research dossiers ([f3f9d83](https://github.com/AI-Substrate/harness-engineering/commit/f3f9d83c5f87c86b3ab257cc5a316fb6b4916fad))
* **doctor:** warn when the sensor watch scanner is not running ([#72](https://github.com/AI-Substrate/harness-engineering/issues/72)) ([81a806c](https://github.com/AI-Substrate/harness-engineering/commit/81a806c1f918091a15d54cc70af2c4a410d51485))
* **eng-harness-flow:** backpressure survey selects the proof, not just the gap ([8eba012](https://github.com/AI-Substrate/harness-engineering/commit/8eba01201f3c2cab7dd9765d94798eba970200cf))
* **eng-harness-flow:** survey speaks human, never overclaims, decides per-task by counts not scores ([5db62a0](https://github.com/AI-Substrate/harness-engineering/commit/5db62a055bee7b3b3d55f69e93f4238477a84edf))
* **sensors:** typed harness extensions + `harness sensors` (TUI + agent JSON) ([#71](https://github.com/AI-Substrate/harness-engineering/issues/71)) ([132e074](https://github.com/AI-Substrate/harness-engineering/commit/132e0749fbf132e8cbcd526586f52848fec686b9))


### Bug Fixes

* **flow:** honour $HARNESS_PLAN_ID for provenance.plan_id; agent stays explicit-only ([#81](https://github.com/AI-Substrate/harness-engineering/issues/81)) ([2253f8c](https://github.com/AI-Substrate/harness-engineering/commit/2253f8c7da26ff1697fb8b55e5fec30b997617e8))
* **skills:** harness seams are mandatory-for-agent, receipted, deadlock-free (field failure: missed seams) ([95ba6fa](https://github.com/AI-Substrate/harness-engineering/commit/95ba6fa7538d97def30bb3a4fff5afd8586d4fc3))
* **telemetry:** repair token evidence end to end (plan 063) ([#80](https://github.com/AI-Substrate/harness-engineering/issues/80)) ([88ca480](https://github.com/AI-Substrate/harness-engineering/commit/88ca4808b671c2b97049af5bb52dadba6f899bb1))

## [0.12.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.11.0...v0.12.0) (2026-07-13)


### Features

* **retro:** harness retro insights — cross-plan analysis verb + flow harvest surface (plan 058) ([#66](https://github.com/AI-Substrate/harness-engineering/issues/66)) ([ec5b785](https://github.com/AI-Substrate/harness-engineering/commit/ec5b78510a262f0ae4d3597b428c2846023e84bc))
* **telemetry:** file-write event — path + change-delta for AI-authorship (plan 056) ([#62](https://github.com/AI-Substrate/harness-engineering/issues/62)) ([3fbdc32](https://github.com/AI-Substrate/harness-engineering/commit/3fbdc32e6a7ebaaec3676496996b22dad5297043))

## [0.11.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.10.0...v0.11.0) (2026-07-10)


### Features

* **057:** P2 — encode token/delegation discipline (both skills) + tripwire runbook ([b7b4b83](https://github.com/AI-Substrate/harness-engineering/commit/b7b4b838009ff8374228a9886c17ffcab7cfe2c1))
* **cli:** flow-local --quiet — mutation envelopes slim to {path} (057 T004-T005) ([0fdf083](https://github.com/AI-Substrate/harness-engineering/commit/0fdf083f61d0b0e76b26aa189c07df521506c287))
* don't apologise — fix (environment-first posture + measurable dispositions) ([7ad1259](https://github.com/AI-Substrate/harness-engineering/commit/7ad1259594c24b67a8176ca221ce92599650335a))
* **observe:** capture-time recurrence fingerprint (plan 056 T002) ([173e3cb](https://github.com/AI-Substrate/harness-engineering/commit/173e3cb24a69f957de8fcf3b904aa7ed243f2182))
* **record:** retro schema 1.2 — optional fp + disposition (plan 056 T001) ([d4bbd8c](https://github.com/AI-Substrate/harness-engineering/commit/d4bbd8c220f16340d6b848da4dbc753113c527d7))
* **telemetry:** flow_log stage-window lookup — per-stage attribution from cursor-moved marks (057 T001-T003) ([6615e48](https://github.com/AI-Substrate/harness-engineering/commit/6615e488d84bfe50aa0dbf3d9683b1d3c1bdd13a))
* **telemetry:** observe_conversion + disposition_mix insight generators (plan 056 T005) ([d4ab395](https://github.com/AI-Substrate/harness-engineering/commit/d4ab39587d4e400d89c8133c5af8b5bf7df156da))
* **telemetry:** observe_kind + retro artifact + disp_/kind_ counts (plan 056 T003) ([c1963cc](https://github.com/AI-Substrate/harness-engineering/commit/c1963cc005dd347ced5dc4f148e874509d8ca211))
* **telemetry:** retro-record artifact extractor (plan 056 T004) ([a59b365](https://github.com/AI-Substrate/harness-engineering/commit/a59b365226a4ebc1711020aa10974ede5b066d2c))


### Bug Fixes

* **056:** write declined entries on pick route + verb-gate observe_kind ([1297967](https://github.com/AI-Substrate/harness-engineering/commit/1297967bdc90ce21424d49db4f1d011865ef5686))
* **057:** FX001 flow friction batch — auto-render on mutate, doctor --quiet, root vitest scope, check:docs verdicts, link + doc hygiene ([ac6724e](https://github.com/AI-Substrate/harness-engineering/commit/ac6724e3de186567cf5e3ff76b73962fbc60f99c))
* **057:** review P1 notes — frozen-bytes envelope regression test; narrow the guide's telemetry claim to position moves ([cbc2d83](https://github.com/AI-Substrate/harness-engineering/commit/cbc2d8366ec924bbb7a1d800cc6262f6548a5cc9))
* **skills:** token-discipline prompt in builder + guard install pollution ([2bbda86](https://github.com/AI-Substrate/harness-engineering/commit/2bbda86ec5c0d293f51bb1de0fb7cc3d05a2c7ba))

## [0.10.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.9.2...v0.10.0) (2026-07-06)


### Features

* **skills:** vendor `builder` flow + bake skills for GitHub-free install ([7d6beef](https://github.com/AI-Substrate/harness-engineering/commit/7d6beef33296778b8a20759e232db2bac0611756))
* **skills:** vendor `builder` flow + bake skills for GitHub-free install ([9d36c82](https://github.com/AI-Substrate/harness-engineering/commit/9d36c828987957e1361503646a63c05aee6e9f60))

## [0.9.2](https://github.com/AI-Substrate/harness-engineering/compare/v0.9.1...v0.9.2) (2026-07-06)


### Bug Fixes

* **telemetry:** seed nextSeq above the durable .flushed watermark ([#53](https://github.com/AI-Substrate/harness-engineering/issues/53)) ([3b02c14](https://github.com/AI-Substrate/harness-engineering/commit/3b02c1469928f47c16048198960d4bd4001da8a6))

## [0.9.1](https://github.com/AI-Substrate/harness-engineering/compare/v0.9.0...v0.9.1) (2026-07-06)


### Bug Fixes

* **release:** disable npm provenance (private repo → E422, publish broken since 0.7.0) ([6ed3098](https://github.com/AI-Substrate/harness-engineering/commit/6ed3098a5b4b152b5f7db7563b50e1cc76b11908))
* **release:** disable npm provenance (private repo → E422, publish broken since 0.7.0) ([7e59db3](https://github.com/AI-Substrate/harness-engineering/commit/7e59db35b2f3b49bb896720e6f1244a84efd0b1e))

## [0.9.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.8.0...v0.9.0) (2026-07-06)


### Features

* **cohort-048:** insights layer v1 — seven sections, discipline panel, structural epistemics, no-mint HTML (Phase 2) ([7c5a793](https://github.com/AI-Substrate/harness-engineering/commit/7c5a7938d19035b7ff79ec164fc2f5a005c8484e))
* **cohort-048:** LLM edge + docs + real-month dogfood fixes (Phase 3) ([4023f9d](https://github.com/AI-Substrate/harness-engineering/commit/4023f9de3280e7b4879f33ac9664183e3b5e5497))
* **cohort-048:** measures foundation — FlowEvent-primary stage lens, sent/received render, month-scoped telemetry sweep (Phase 1) ([f3fea42](https://github.com/AI-Substrate/harness-engineering/commit/f3fea425a97ffabb3627007286cc1cebd6e0e4f0))
* **doctor:** version-skew layer — detect a stale global harness shadowing the repo build ([9d76876](https://github.com/AI-Substrate/harness-engineering/commit/9d768763549e45c81a0882b946fc29eaa0644ee7))
* **flow-eval-041:** md-to-pdf-ponytail scenario — third cohort, /ponytail full mandate ([eb8c805](https://github.com/AI-Substrate/harness-engineering/commit/eb8c805bbaf70faecc56e40c0dfa88d3bf55aa31))
* **flow-eval-041:** md-to-pdf-ponytail-harness scenario — the loop carve-out A/B ([9d3946c](https://github.com/AI-Substrate/harness-engineering/commit/9d3946c46b3080cba1daa9fd570db5760e6e23e6))
* **flow-eval-046:** comparability round — per-run --resolve, ledger supersede, pinned-worktree runbook (task 4.6) ([4c7e736](https://github.com/AI-Substrate/harness-engineering/commit/4c7e736a54c5f631737ce4de034b347799a2df58))
* **flow-eval-046:** hardened scoring, run ledger + comparison, judge hardening, eval-runner skill (P1-P3 + docs) ([e27e4c6](https://github.com/AI-Substrate/harness-engineering/commit/e27e4c69bc0f5028c80b224154a7236de52b5fac))
* **flow-eval:** flow-conformance eval harness (plan 041) ([c7dbff4](https://github.com/AI-Substrate/harness-engineering/commit/c7dbff493567b1bd6474c0edaed0facf49eb8de3))
* **flow-eval:** md-to-pdf-flow scenario, unknown-lane compare fix, eval docs + explainer ([a9235b4](https://github.com/AI-Substrate/harness-engineering/commit/a9235b47cc68e15894931ccdefd552d40fefc4dc))
* **ref-rollup-049:** one start-dated rolled ref per session + history-union migration + buffer prune (Phase 1) ([0f01667](https://github.com/AI-Substrate/harness-engineering/commit/0f016671bf214e0b9f4602da215279d01d48aa8f))
* **telemetry-047:** FX001 — capture shell command + skill digit signatures ([057f311](https://github.com/AI-Substrate/harness-engineering/commit/057f311b368f32e9f280e2205c2b2cfe6b7ed605))
* **telemetry-050:** semantic artifact telemetry — artifact event kind + 10-extractor registry, change-triggered in the capture window ([cf28e3a](https://github.com/AI-Substrate/harness-engineering/commit/cf28e3aa2402d749b81920f6e16561787bba208b))
* **telemetry-051:** fleet session join — get-fleet verb, FleetEvidence service, scenario intent (phase 1) ([f770402](https://github.com/AI-Substrate/harness-engineering/commit/f770402c9536dda3570082e43fda8289f8f4b41b))
* **telemetry-052:** fleet lane sources + capture fixes (Phase 1) ([6b2811b](https://github.com/AI-Substrate/harness-engineering/commit/6b2811ba29b76ee6018c8f097e369dbddc76e69e))
* **telemetry-052:** fleet semantic rollup (Phase 2, T009-T012) ([46a3ec9](https://github.com/AI-Substrate/harness-engineering/commit/46a3ec9c72cb095dfa136010ea52d02d0bce203d))
* **telemetry:** add `harness telemetry mark` peer self-attestation verb (plan 053 Phase 1) ([3c3e465](https://github.com/AI-Substrate/harness-engineering/commit/3c3e46544f159d60518e8b32f8f13fa0a7522fc8))


### Bug Fixes

* **flow-eval-046:** dogfood run-1 fix round — subject/base-ref fidelity, unmeasured-axis render, judged re-render (task 4.5) ([a33e3b5](https://github.com/AI-Substrate/harness-engineering/commit/a33e3b5bc26b87993c9f89716e42ab0c8f71e6d2))
* **telemetry-047:** honest attribution (FX002) + tool-result-size capture (FX003) ([9473dde](https://github.com/AI-Substrate/harness-engineering/commit/9473ddec97453b761fa3582b8f5e2655234c142a))
* **telemetry-049:** dedupe loose union blobs by name when the ref tip is an old-shape tree ([c159d3d](https://github.com/AI-Substrate/harness-engineering/commit/c159d3d6ee1a27b65bc52cd8da9d0d0ac69a7aae))
* **telemetry-052:** aggregate plan_cs into fleet-level semantics (d-002 F1) ([dd41522](https://github.com/AI-Substrate/harness-engineering/commit/dd4152262c8904e274fd6cd5f00cecb4f079ef1e))
* **telemetry-052:** descriptor-independent ledger join survives pij close (SUGG-001) ([7c4a7fe](https://github.com/AI-Substrate/harness-engineering/commit/7c4a7fe3388adfdf8aa15d15608bbad048fed4a2))
* **telemetry-052:** malformed side-channel ledgers degrade, not vanish (F1) ([533ea8f](https://github.com/AI-Substrate/harness-engineering/commit/533ea8f98cf155cc12e3ea98092690bbeb55931b))
* **telemetry:** copilot adapter captures apply_patch file writes (F-07 follow-on) ([fbb0f6c](https://github.com/AI-Substrate/harness-engineering/commit/fbb0f6cb3c42d981914dfbfb0d11d6663d4b712b))


### Performance Improvements

* **ref-rollup-049:** manifest-only no-op sync decision via fail-closed readRefBlob (DL-001) ([9c120bc](https://github.com/AI-Substrate/harness-engineering/commit/9c120bcb12bd4676d9b2d217fc6155a92837e586))

## [0.8.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.7.0...v0.8.0) (2026-06-30)


### Features

* **flow-042:** per-phase review spine node — parity twin + docs + plan ([7b1f708](https://github.com/AI-Substrate/harness-engineering/commit/7b1f7089487da29f42978b5e9271dfd2e99061c3))
* **flow-render:** sectioned layout — kill the diagonal spine skew ([a37a601](https://github.com/AI-Substrate/harness-engineering/commit/a37a601a299a8e78ced7448172f14919afe261ac))
* **flow-render:** TD two-column renderer layout (plan 043) ([2156f0f](https://github.com/AI-Substrate/harness-engineering/commit/2156f0fb4b15658d680165901c1c62a85ff9fc59))
* **flow:** per-phase review spine node + TD two-column renderer (plans 042–043) ([b97c317](https://github.com/AI-Substrate/harness-engineering/commit/b97c31729afdcc41a0ce42fc8e6bce3d60853d87))

## [0.7.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.6.0...v0.7.0) (2026-06-29)


### ⚠ BREAKING CHANGES

* **telemetry:** drop branch_changed boolean — the branch event is the single source of truth
* **telemetry:** schema 1.1 — command/prompt signals + compact subagents

### Features

* **eng-harness-flow:** restore the retro→extension encoding bridge dropped in 022 ([790bd08](https://github.com/AI-Substrate/harness-engineering/commit/790bd08d172e57c3dab4e75c3e61a64149355d63))
* **flow-039:** Phase 1 — transactional node primitives + chore-aware renderer + canonical seam doctrine ([4f4b384](https://github.com/AI-Substrate/harness-engineering/commit/4f4b384c53a532df90fd406d51680248f8edd927))
* **flow-039:** Route A — transactional flow primitives + chore-aware renderer + canonical seam doctrine ([b95ca23](https://github.com/AI-Substrate/harness-engineering/commit/b95ca237ad98933ccba02d72ecf9e56461ee739f))
* **flow-040:** P1 — per-node instructions[] field + set-node flags ([f7ac73f](https://github.com/AI-Substrate/harness-engineering/commit/f7ac73ffcc8684f735fc350b9513f5f603192964))
* **flow-040:** P2 — `harness flow orient` read (default human, --json opt-in) ([7e9582a](https://github.com/AI-Substrate/harness-engineering/commit/7e9582a792179a5c997a7c406632b297bc1ce191))
* **flow-040:** P3 — renderer D5 (colour=type, badges, importance, legend) ([b4f2209](https://github.com/AI-Substrate/harness-engineering/commit/b4f2209f15a50960bed6c902ffda98cc477f4b66))
* **flow-040:** P5 — doctrine-parity guard + eng-harness-flow D1 coexistence ([c09361a](https://github.com/AI-Substrate/harness-engineering/commit/c09361ab4fe46c1fb472c39b1846145739b50fa5))
* **flow-040:** visible chore status + vivid render palette + current-node highlight ([d0a5084](https://github.com/AI-Substrate/harness-engineering/commit/d0a50843404b43719bcfebc25f7c79da11c29166))
* **telemetry-038:** T001 — 3-way OTLP conformance harness + protobufjs devDep ([75992b1](https://github.com/AI-Substrate/harness-engineering/commit/75992b125f9bec1ad5ad58aa7567bfe94c0026ad))
* **telemetry-038:** T002/T006/T007/T009 — OTLP Logs serializer + reconstruction proof ([4bd2a5a](https://github.com/AI-Substrate/harness-engineering/commit/4bd2a5a88705b68bfe390608e1a1acb0e4f35df8))
* **telemetry-038:** T005 — mint + drift-guard per-instance OTLP goldens ([9cc6f8a](https://github.com/AI-Substrate/harness-engineering/commit/9cc6f8a4673957c30b2f28c2e1195d50208a015e))
* **telemetry-038:** T008 — rollup → OTLP Metrics (cumulative-per-session) ([5a22e5f](https://github.com/AI-Substrate/harness-engineering/commit/5a22e5fbdb7eba4143153878b234741f42331d35))
* **telemetry-038:** T010 — emit transport-agnostic OTLP spool at the capture seam ([678ed81](https://github.com/AI-Substrate/harness-engineering/commit/678ed816e7d0df9184fff03ca03a72198b4e2c00))
* **telemetry-038:** T011 — publish OTLP .jsonl spool over keep-and-harden git-refs ([ab03aa0](https://github.com/AI-Substrate/harness-engineering/commit/ab03aa0fd1688feea26e7b78b3e57d7cee6010c5))
* **telemetry-038:** T012 — harden the keep (H4 session-id entropy, H5 idempotent re-push) ([3a36cf3](https://github.com/AI-Substrate/harness-engineering/commit/3a36cf3301be88b717ffbd8b55b74c5ae98ddff2))
* **telemetry-038:** T014 — freeze the harness.* OTLP attribute contract + retarget tests ([05995ee](https://github.com/AI-Substrate/harness-engineering/commit/05995eeacc032c417dfe8fb34a559cfc21a09409))
* **telemetry:** capture allowlisted env vars into segments (captured_env, schema 2.2) ([5b4b5b2](https://github.com/AI-Substrate/harness-engineering/commit/5b4b5b20fa534d79db38d5b51f64ccd53986fe23))
* **telemetry:** Claude adapter emits v2 event stream (Phase 5 T5.4a) ([c2a0712](https://github.com/AI-Substrate/harness-engineering/commit/c2a0712a1013a52b27c657ad4d97fde68cd1ef98))
* **telemetry:** compute branch_changed + emit a branch event (034 P5 DL-003) ([77b12eb](https://github.com/AI-Substrate/harness-engineering/commit/77b12eb494c6204e65238014edb2367ed7055473))
* **telemetry:** Copilot adapter emits v2 event stream (Phase 5 T5.4b) ([5be03e5](https://github.com/AI-Substrate/harness-engineering/commit/5be03e545a192513f0090f6611c10a9181c16cc7))
* **telemetry:** Copilot VS Code Chat surface + attributable commits (plan 034 Phase 6 / A4) ([#40](https://github.com/AI-Substrate/harness-engineering/issues/40)) ([c6c2134](https://github.com/AI-Substrate/harness-engineering/commit/c6c2134c781d2a1240af86c2cd0cefef97bf6540))
* **telemetry:** Cursor adapter emits bubble-anchored v2 event stream (Phase 5 T5.5) ([7f68d17](https://github.com/AI-Substrate/harness-engineering/commit/7f68d1788ba5627ba6cc66723e689fb22f9530a0))
* **telemetry:** cursor model attribution via read-only sqlite DbPort ([42cc8a5](https://github.com/AI-Substrate/harness-engineering/commit/42cc8a5804b14dd44c1ae721423a213795ef30ed))
* **telemetry:** cursor-agent capability adapter ([7b0e67b](https://github.com/AI-Substrate/harness-engineering/commit/7b0e67b7dbc99729f5c8fa6d6f499e71c4f6b58d))
* **telemetry:** flow_log replay — surface the-flow's events[] into the stream (plan 035) ([4cf8621](https://github.com/AI-Substrate/harness-engineering/commit/4cf86216cc18bbe9c8588b8d97f6faa858e67315))
* **telemetry:** flow-stage events from the-flow.json nav (034 P5 T5.6) ([5245dfe](https://github.com/AI-Substrate/harness-engineering/commit/5245dfe336bf2042c5b747af5bd8115c37f9f4b1))
* **telemetry:** OTEL/OTLP telemetry standard + env capture (plan 038) ([6dd8b82](https://github.com/AI-Substrate/harness-engineering/commit/6dd8b82c4c576baddb50667f73cc9c5c7b10a6ab))
* **telemetry:** outcome events checks + command_exit (034 P5 T5.7) ([b7d0a0e](https://github.com/AI-Substrate/harness-engineering/commit/b7d0a0e395bcd0351cf2b46e009611482b93472e))
* **telemetry:** real scrubbed fixture corpus + review fixes (plan 037) ([#42](https://github.com/AI-Substrate/harness-engineering/issues/42)) ([253daf5](https://github.com/AI-Substrate/harness-engineering/commit/253daf5b256c2f946ea9992041919d7fdf8b6cab))
* **telemetry:** recursion-safe post-commit telemetry flush + doctor scan + --no-verify push ([0e7d471](https://github.com/AI-Substrate/harness-engineering/commit/0e7d471197a130f41f9e74afd98996d72e21429e))
* **telemetry:** schema 1.1 — command/prompt signals + compact subagents ([24d46b3](https://github.com/AI-Substrate/harness-engineering/commit/24d46b3a0580285724664f5d054e9118780cbaeb))
* **telemetry:** segment v2.0 event stream + rollup engine (Phase 5 T5.1-5.3) ([7d33083](https://github.com/AI-Substrate/harness-engineering/commit/7d330839315f1859dadb6a8c8029e0ff7b7fdc3a))
* **telemetry:** stamp the producing CLI version → segment harness_version + OTLP service.version ([254f710](https://github.com/AI-Substrate/harness-engineering/commit/254f7109ec6ec8e2fea8b59c12346ec41dbf0fe0))
* **telemetry:** v2 event-stream telemetry + flow replay (plans 034 P5 + 035) ([1af767a](https://github.com/AI-Substrate/harness-engineering/commit/1af767ad2cf951f89775de97e9e00f7260dc4fe2))
* **telemetry:** v2-lean segment — drop command arrays, omit empties, surface harness verb in timeline ([f14d640](https://github.com/AI-Substrate/harness-engineering/commit/f14d6404aa5af21410b31cd792c87b65d0c54d1e))


### Bug Fixes

* **ci:** remove the pre-push checks gate — it recursed via telemetry auto-sync ([b2861a5](https://github.com/AI-Substrate/harness-engineering/commit/b2861a5caede777fed8c342f327cd8fd5c583368))
* **flow-040:** P3.1 — `observe` is a harness type (D5 colour parity) ([cc4f9c5](https://github.com/AI-Substrate/harness-engineering/commit/cc4f9c5ec15af04281540403962883ab01b41026))
* **flow-040:** renderer emitted INVALID mermaid (chained :::class) — split to a class statement ([c28a8c9](https://github.com/AI-Substrate/harness-engineering/commit/c28a8c966f3d6be78e04501b2ad2cc20b7f0cb8f))
* **flow:** accept --message as an alias for --text on `flow comment` ([3505801](https://github.com/AI-Substrate/harness-engineering/commit/3505801ba8a32f088ed93d618a2e6bd24c5c6766))
* **telemetry-038:** address 2 review findings (metrics flow_log bounds + 14-kind coverage) ([b5189f3](https://github.com/AI-Substrate/harness-engineering/commit/b5189f3ba0d1b68f0c6d20178507b034c75a53a4))
* **telemetry-038:** address companion phase-drain review (1 HIGH + 2 MEDIUM, run 0d3a) ([f3cd90a](https://github.com/AI-Substrate/harness-engineering/commit/f3cd90a9c318281eb00e8528ee626a3f01748d03))
* **telemetry-038:** F1 — watermark must not skip an un-flushed seq on interleaved date buckets ([c967f41](https://github.com/AI-Substrate/harness-engineering/commit/c967f41ee4a5e3f0dcf04dbd8b662b2daa022fce))
* **telemetry-038:** T011 — never publish-and-consume a partial OTLP spool ([4e97524](https://github.com/AI-Substrate/harness-engineering/commit/4e97524979c5c0b3ca4d76fbfe12f08ca2c8ca42))
* **telemetry:** address flow_log review (F001 schema drift HIGH + F002/F003/F007) ([511c126](https://github.com/AI-Substrate/harness-engineering/commit/511c1261d6f565ee0bf9bf67153c59563185f6d0))
* **telemetry:** cast serializeEvent unknown-kind skeleton to Event (034 P5 build) ([55df92a](https://github.com/AI-Substrate/harness-engineering/commit/55df92aca1bb28b9252f3b23ad426759c0c97499))
* **telemetry:** companion F003 HIGH + F004-F007 (034 P5 outcome provenance + docs) ([cf8ede2](https://github.com/AI-Substrate/harness-engineering/commit/cf8ede2b20be5f07ef4163189cb0e7a269a2c39b))
* **telemetry:** Copilot command_exit only for a lone harness command (034 P5 F008) ([f3d227d](https://github.com/AI-Substrate/harness-engineering/commit/f3d227d06c04a0f6dbacb21c05bd91aee1c34711))
* **telemetry:** decouple Copilot command capture from toolName (034 P5) ([aa1eb31](https://github.com/AI-Substrate/harness-engineering/commit/aa1eb31b17785dfd0d927204f40c35b77d9cf995))
* **telemetry:** emit Copilot tool event when name is only on execution_complete (companion HIGH, AC-16) ([610b872](https://github.com/AI-Substrate/harness-engineering/commit/610b87282b0030b5457a85d3afbf3a74e665f2b3))
* **telemetry:** repair Copilot adapter for current Copilot CLI format ([9e84e1e](https://github.com/AI-Substrate/harness-engineering/commit/9e84e1ef745e2e8caa1a4bd493ba076c8635c18c))
* **telemetry:** resolve flight-plan path from deep cwd (034 P5 companion F001/F002) ([f271492](https://github.com/AI-Substrate/harness-engineering/commit/f2714923116df67ffd0c174e5ff19108baa67b94))
* **telemetry:** stop spooling no-activity captures + nested-invocation re-entrancy guard ([b8f9993](https://github.com/AI-Substrate/harness-engineering/commit/b8f9993b60850cb5745c24eef219e75b956a722d))


### Code Refactoring

* **telemetry:** drop branch_changed boolean — the branch event is the single source of truth ([f0bf241](https://github.com/AI-Substrate/harness-engineering/commit/f0bf241253b010b18679a4207b8b7c841a0670bb))

## [0.6.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.5.0...v0.6.0) (2026-06-24)


### Features

* **flow:** anchor injected loop-chores as deterministic checks (plan 033) ([#36](https://github.com/AI-Substrate/harness-engineering/issues/36)) ([10963e7](https://github.com/AI-Substrate/harness-engineering/commit/10963e70cdb0b224283846eeccb65f33dadec690))
* harness telemetry collection (plan 034) + boot/checks quality-gate nucleus ([#37](https://github.com/AI-Substrate/harness-engineering/issues/37)) ([ed09d53](https://github.com/AI-Substrate/harness-engineering/commit/ed09d53ad27b374765cfc5bed2f371be2f344314))
* **skills:** add grill-agent-done interrogation companion ([#29](https://github.com/AI-Substrate/harness-engineering/issues/29)) ([b417e67](https://github.com/AI-Substrate/harness-engineering/commit/b417e67f6e4b671896494acf29f82a2a16d71907))


### Bug Fixes

* **eng-harness-flow:** plain-language retro drain prompt (kill [s/t/p/e/d/a] jargon) ([#35](https://github.com/AI-Substrate/harness-engineering/issues/35)) ([56d91fa](https://github.com/AI-Substrate/harness-engineering/commit/56d91faf9c372cb432bb90940fda22af79d911b7))

## [0.5.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.4.0...v0.5.0) (2026-06-19)


### ⚠ BREAKING CHANGES

* **022:** consolidate eng-harness skills (7 → 2: flow router + assessment peer) ([#27](https://github.com/AI-Substrate/harness-engineering/issues/27))

### Features

* **021:** five neutral lifecycle hooks for eng-harness-flow (--hook/--hooks/--help) ([#25](https://github.com/AI-Substrate/harness-engineering/issues/25)) ([9ce4613](https://github.com/AI-Substrate/harness-engineering/commit/9ce46133705c37cadb7727312dfe63a60191edc1))
* first-class flow system + the-flow/eng-harness-flow on the CLI (plans 024–032) ([#28](https://github.com/AI-Substrate/harness-engineering/issues/28)) ([ce2b4ff](https://github.com/AI-Substrate/harness-engineering/commit/ce2b4ff35aea7ff3124f02c18724f16ca7ba4426))


### Code Refactoring

* **022:** consolidate eng-harness skills (7 → 2: flow router + assessment peer) ([#27](https://github.com/AI-Substrate/harness-engineering/issues/27)) ([9d79a76](https://github.com/AI-Substrate/harness-engineering/commit/9d79a762935927bc5a689505baaa5c7449c55afb))

## [0.4.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.3.0...v0.4.0) (2026-06-16)


### Features

* **019:** ambient CLI model + retro routing, deck/static-site rework ([#22](https://github.com/AI-Substrate/harness-engineering/issues/22)) ([f47a08a](https://github.com/AI-Substrate/harness-engineering/commit/f47a08a3dee5a3ac92a4ee21079ae0e043acc8e0))
* **020:** harness-bypass/-change record types, win kind, capture seams, measures doc ([#23](https://github.com/AI-Substrate/harness-engineering/issues/23)) ([03b4a2d](https://github.com/AI-Substrate/harness-engineering/commit/03b4a2dbc3f6e90a3820ba175a5338ca6bbce41a))
* **cli:** cross-platform exec — run Windows .cmd/.bat shims safely ([#20](https://github.com/AI-Substrate/harness-engineering/issues/20)) ([fe9c834](https://github.com/AI-Substrate/harness-engineering/commit/fe9c8346ddb35f35f9d5304c24321a90e9ecf5ad))

## [0.3.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.2.0...v0.3.0) (2026-06-15)


### Features

* **019:** harness self-update (`harness update`) + zero-auth public-npm distribution ([#19](https://github.com/AI-Substrate/harness-engineering/issues/19)) ([7f11fdc](https://github.com/AI-Substrate/harness-engineering/commit/7f11fdcb9407cb97f1e4bf82873421642c9b6479))
* **cli:** 'harness skills update' — refresh skills and prune renamed-away slugs ([62520ab](https://github.com/AI-Substrate/harness-engineering/commit/62520abcb04db14787cdcd4c3acd9c025ccdaf0e))
* **cli:** add 'engh' alias bin alongside 'harness' ([3906e83](https://github.com/AI-Substrate/harness-engineering/commit/3906e83985a80c2dd88e1941a5ec3f02af134525))
* **deck:** glide is the law for flying panels — cardIn retired ([9bd4d6a](https://github.com/AI-Substrate/harness-engineering/commit/9bd4d6ab5dfeb7309d65cf0c276629eaa0d7fa15))
* **deck:** little next/prev buttons in read mode ([9bdaaaa](https://github.com/AI-Substrate/harness-engineering/commit/9bdaaaa55864e8d41d54ef26f16facac37a0fe5a))
* **deck:** reword "stack" → "layers" on S2/S15 (narration + on-screen) ([3537294](https://github.com/AI-Substrate/harness-engineering/commit/3537294776aece9e4e45a77f506bdc3eac52d9c5))
* **deck:** S14 re-take ('tools AND BACKPRESSURE SENSORS') + true S13→S14 match-cut ([953a3e4](https://github.com/AI-Substrate/harness-engineering/commit/953a3e41cce14156fb01fd969e6bc1ac5ad501b2))
* **deck:** S2 flow rails replace hop dots; S4 INFERRED verdict stamp ([a7651d4](https://github.com/AI-Substrate/harness-engineering/commit/a7651d48ccd7b84a27f4a5d240de75c52254d29b))
* **deck:** S2 plate stroke flourish; intent rail clears the stack ([df8b81e](https://github.com/AI-Substrate/harness-engineering/commit/df8b81ea25fd50276c0e3492729efd617934e2c1))
* **deck:** S5 quirk gags — the codebase pile acts out its own line ([5550511](https://github.com/AI-Substrate/harness-engineering/commit/5550511c6b19eb60a9a3c7c2b4af11bcb02f1ab0))
* **deck:** top-and-tail install CTAs with copy-button prompt ([32d6b90](https://github.com/AI-Substrate/harness-engineering/commit/32d6b90e5cd51277792332cfe741d6f36a061597))
* **deck:** word-sync all slides to narration via cue blocks ([0b33304](https://github.com/AI-Substrate/harness-engineering/commit/0b333048dd769c47ada7e1bf0ed979efee5ee57a))
* **deck:** word-sync S2 to narration via forced alignment ([cb2516e](https://github.com/AI-Substrate/harness-engineering/commit/cb2516e6400f8d1a1c4920619d76a3bfaa0941b1))
* **init:** `harness init` — INCEPTION writer of the governance doc (FX001) ([#17](https://github.com/AI-Substrate/harness-engineering/issues/17)) ([9e2224a](https://github.com/AI-Substrate/harness-engineering/commit/9e2224aab8f4d2c39ad80c9793f41705f3e63975))
* **layers:** HUMAN STEERING LAYER (THIS IS YOU) across all mirrors ([b57d54c](https://github.com/AI-Substrate/harness-engineering/commit/b57d54cc04b64eefb52a2fa5927a6c0c9190cb30))
* **layers:** single-view layer map at top of layers.html ([da2a672](https://github.com/AI-Substrate/harness-engineering/commit/da2a67211190345d26c9cee0b6bf8bc8c73da4a6))
* **presentations:** auto-mux same-stem narration into recorded clips ([488c3df](https://github.com/AI-Substrate/harness-engineering/commit/488c3df0805cf49a7471b52182eadde387861a0e))
* **presentations:** Missing Layer 101 — 20 self-playing animated scenes ([10064a6](https://github.com/AI-Substrate/harness-engineering/commit/10064a6eb7b9981502f62f22f6660c1c53555452))
* **presentations:** numbered clip stems + ElevenLabs narration script ([2744212](https://github.com/AI-Substrate/harness-engineering/commit/27442124952b428cb066adb7cd777a8ef6c10716))
* **presentations:** per-slide narration + full-comp builder ([21fae96](https://github.com/AI-Substrate/harness-engineering/commit/21fae965962ad5120e74d217fade59c0b672f7ce))
* **presentations:** per-slide video recorder (WAAPI scrub -&gt; mp4) ([3b3896a](https://github.com/AI-Substrate/harness-engineering/commit/3b3896a9efc5a323b13ecb5332d79468547a3f4d))
* **presentations:** speaking-speed control for narration ([b1e91f5](https://github.com/AI-Substrate/harness-engineering/commit/b1e91f5f226ff90bbf2fed11dc126dc38dba1c1b))
* **skills,cli:** surface the deterministic-layer thesis on first-contact surfaces ([6771655](https://github.com/AI-Substrate/harness-engineering/commit/67716551b32a405a9fd9993a08725bcfb7357cee))
* **skills:** real inject step (S3) — record the injection map so the harness survives cold starts ([2e2ec94](https://github.com/AI-Substrate/harness-engineering/commit/2e2ec94e3a5e68d1c5267e2dd00507ed9177fadd))
* **static-site:** full intro deck (index.html) + layers overview ([dcb4b3b](https://github.com/AI-Substrate/harness-engineering/commit/dcb4b3b14fc12338f39a8c1ddeb8cebefbf947bb))
* **tools:** hq recipe is the default — 60fps, 2x supersampled capture ([9a77b29](https://github.com/AI-Substrate/harness-engineering/commit/9a77b296a329dcc7ad4cece0326fff1770c1a00c))
* **tools:** native 4K60 is the output default ([8023ac3](https://github.com/AI-Substrate/harness-engineering/commit/8023ac3cf7ae4b27d9db4bdb6d98eef390b620a9))
* **tools:** stable text raster + supersampled capture path in record.cjs ([3dd51c4](https://github.com/AI-Substrate/harness-engineering/commit/3dd51c4e141c84c8e9ae9b8b60db3ac8f8192ae4))


### Bug Fixes

* **deck:** agenda heading 'Where we're going' -&gt; 'The contents.' ([b5dd6c0](https://github.com/AI-Substrate/harness-engineering/commit/b5dd6c067cdf7eacdb72f38ad5ba8e3e21e79bad))
* **deck:** dock S2/S15 leader pips to plate corners, riding the rig bob ([0edff63](https://github.com/AI-Substrate/harness-engineering/commit/0edff63a68435efdc35eeb5df728a85188596aa0))
* **deck:** keep S15 done?/encode decals fully on the ink plate ([2238778](https://github.com/AI-Substrate/harness-engineering/commit/223877803a946cd13b314c981c5eb0f7a16a9b8c))
* **deck:** no entrance fades on scenes that continue across a cut ([99b76e8](https://github.com/AI-Substrate/harness-engineering/commit/99b76e8f52c49805153df204b5735fb4cb93d9f4))
* **deck:** restore canonical layer wording on the layers slide ([75c0891](https://github.com/AI-Substrate/harness-engineering/commit/75c0891193f6f7ccfe8600f3f66c75727cb4e6ef))
* **deck:** S13 qFlip is one transform segment — kills the 62% velocity snap ([82221b7](https://github.com/AI-Substrate/harness-engineering/commit/82221b7f98a63cc6706bd2cb89ef832e8d230f78))
* **deck:** S14 A/B badges pop .3s early — impact lands on the spoken word ([e20936f](https://github.com/AI-Substrate/harness-engineering/commit/e20936f5f1c70ea5abdc05199709104c02defcf5))
* **deck:** S15 done?/encode pills — equal boxes, centred text, even spread ([a11d268](https://github.com/AI-Substrate/harness-engineering/commit/a11d26867f1faf380a23042984c6bb5bc8e97a29))
* **deck:** S15 labels ride their plates through the gap move ([4cf2bb2](https://github.com/AI-Substrate/harness-engineering/commit/4cf2bb25f6f462c89849462cada08eea127529ea))
* **deck:** S16 pill alignment; S13/S14 question-2 broadened to all learning ([7b44b5e](https://github.com/AI-Substrate/harness-engineering/commit/7b44b5e9aae59599ba4146f9cf8226787941b57b))
* **deck:** S17 convergence dots derived exactly from the cv line endpoints ([a2a10e0](https://github.com/AI-Substrate/harness-engineering/commit/a2a10e094ce21086ff16b323871c4d566f280786))
* **deck:** S2 agent blink+idle survives agentScan; S4 cards glide in clean ([e96a508](https://github.com/AI-Substrate/harness-engineering/commit/e96a508bf64322b71b11bc1a5e0d3917719d7603))
* **deck:** S2 shadows arrive with their owners; pips hop the stack ([51d4f11](https://github.com/AI-Substrate/harness-engineering/commit/51d4f119064bfbbd2b5399c03e2ddfb3b6175673))
* **deck:** S7 agent rides the trail line; callout stems reach their pins ([7e7d9ee](https://github.com/AI-Substrate/harness-engineering/commit/7e7d9ee1662ce5135277e293d362296f9bd4b0d7))
* **deck:** vs slide — concrete examples on the engineering-harness card ([2056e57](https://github.com/AI-Substrate/harness-engineering/commit/2056e570987bbc4cab8743ca3634c9eb63a420e7))
* **layers:** lead each layer section with the layer NAME, not its descriptor ([90094ec](https://github.com/AI-Substrate/harness-engineering/commit/90094ecf3d895f219f1281f6f8353cbcd102c8d5))
* **presentations:** accept --flag value form in tool arg parsing ([63a00f7](https://github.com/AI-Substrate/harness-engineering/commit/63a00f764d22733423e1c209389dcafcbe942cdf))
* **presentations:** equal-length audio/video streams + 1s narration lead/tail ([71df681](https://github.com/AI-Substrate/harness-engineering/commit/71df681ccdacc406668a6d00d36c37bbbe33b0cf))
* **presentations:** pin v3 voice with Robust stability ([3e9673d](https://github.com/AI-Substrate/harness-engineering/commit/3e9673d6f5256dcdbb42a6266c015838aa2fe975))
* **skills:** full GitHub URLs for repo-content references ([9ba602c](https://github.com/AI-Substrate/harness-engineering/commit/9ba602ca1798783dfe7e45d37fd515278d3d9d63))
* **skills:** inject step asks first, per surface — hand-hold, never bomb-in ([90d8f39](https://github.com/AI-Substrate/harness-engineering/commit/90d8f39b80cfd58cafdb784d22eafccff284a309))
* **skills:** scope installer source to /skills subpath ([e98b03b](https://github.com/AI-Substrate/harness-engineering/commit/e98b03b29c341e26957cc130c816432f425c4a23))
* **skills:** setup probes for an existing harness before installing ([ab79196](https://github.com/AI-Substrate/harness-engineering/commit/ab79196e3291ecd4ee829d2bcb3b06e4a331b50f))
* **tools:** recorder waits for compositor commit; determinism flags ([e148956](https://github.com/AI-Substrate/harness-engineering/commit/e148956dd44333cb6d917203b99a8c5e2391a7e8))

## [0.2.0](https://github.com/AI-Substrate/harness-engineering/compare/v0.1.0...v0.2.0) (2026-06-11)


### ⚠ BREAKING CHANGES

* **release:** package renamed to @ai-substrate/engineering-harness; the contract import becomes @ai-substrate/engineering-harness/contract and the CLI installs from GitHub Packages (consumer .npmrc + read:packages token).
* **harness-cli:** remove BUILTIN_SLOTS / run scaffolding (T017)

### Features

* **008:** rewrite engineering-harness-setup SKILL.md as lean install-&gt;assess-&gt;boot flow (T001) ([3c9bcbc](https://github.com/AI-Substrate/harness-engineering/commit/3c9bcbc2d98f3ec36002f54051f9a8f8b0357d4a))
* **009:** A-F matrix + scoring bands + fan-out re-map (T009-T011, T003 bands) ([713c423](https://github.com/AI-Substrate/harness-engineering/commit/713c4236fd544d648c2df2af195a3069b824e6cc))
* **009:** author validate-harnessability dogfood verb (T016, T016b) ([5b1054a](https://github.com/AI-Substrate/harness-engineering/commit/5b1054a2a8c0a98388d8ee85f3b65bd06333b4be))
* **009:** author validate-harnessability-assessment-skill minih worker (T017) ([1fe8331](https://github.com/AI-Substrate/harness-engineering/commit/1fe83318bf1110a5300288ee5bfb2fea58fd0663))
* **009:** migrate output path to .harness/reports/harnessability/ + preserve latest.json sentinel (T004) ([b3ab547](https://github.com/AI-Substrate/harness-engineering/commit/b3ab54743a0e66ea265671a60e7bd88f44403fb7))
* **009:** schema v0.2 core — version + 12 optional survey keys + A-F grade (T001-T003) ([f58a5eb](https://github.com/AI-Substrate/harness-engineering/commit/f58a5eb61f4ff41437596b85a7d24d2dce308c4e))
* **009:** summary template + full v0.2 example regen (T012-T013) ([ad2a764](https://github.com/AI-Substrate/harness-engineering/commit/ad2a7648ee1fd2796f1ee7976453a357953caa7c))
* **009:** survey existing engineering environment first (T005-T008) ([61501f1](https://github.com/AI-Substrate/harness-engineering/commit/61501f1954733af4df53189aa97bace8b49c3eeb))
* **009:** wire harnessability-assessment skill into .minih.json + smoke-verify dogfood verb (T018) ([fee2789](https://github.com/AI-Substrate/harness-engineering/commit/fee278909908515485cc98e7eb3c28e97ca88714))
* **013:** --collect mode — poll-to-terminal, classify, rollup (T007) ([44d6962](https://github.com/AI-Substrate/harness-engineering/commit/44d696207e67e489fb294fe1b6d0a047fbbb9774))
* **013:** orchestrator extension — fire path + manifest (T006) ([5ec8069](https://github.com/AI-Substrate/harness-engineering/commit/5ec80693355b544977f6fa4296b299fa9d09c399))
* **013:** scaffold validate-harness-flow worker agent (T001) ([8159581](https://github.com/AI-Substrate/harness-engineering/commit/8159581362c8eba86583f7371a1f508251ded92f))
* **013:** worker instructions.md rules (T004) ([3bc093a](https://github.com/AI-Substrate/harness-engineering/commit/3bc093a8da1ca188896e3499be2b6fef122712ac))
* **013:** worker output-schema with AC-6 report contract (T002) ([1d4bc2e](https://github.com/AI-Substrate/harness-engineering/commit/1d4bc2e01351e48a4275b17347de215638396cee))
* **013:** worker prompt.md — the autonomous setup recipe (T003) ([9b2d3ee](https://github.com/AI-Substrate/harness-engineering/commit/9b2d3ee3c1935b3fd658aa07af21a0ff7845e8aa))
* **014:** T001+T002 folder-only discovery + rejected-entry E143 records ([46c3c8a](https://github.com/AI-Substrate/harness-engineering/commit/46c3c8ac07172c58cb7bdcf7e678781caf0a1a71))
* **014:** T003+T004 harness instructions act — baked core briefing + runtime verb briefings ([637fe46](https://github.com/AI-Substrate/harness-engineering/commit/637fe4603f3986c5fc9ec974a05ad886a7f7e78c))
* **014:** T005+T006 help surfaces AGENTS START HERE + per-verb has_instructions ([724ab9c](https://github.com/AI-Substrate/harness-engineering/commit/724ab9c0fd43bf0a976a68aa00cb6c5c133fb05d))
* **014:** T007+T008 doctor wails on missing instructions.md (package convention) ([d1395cb](https://github.com/AI-Substrate/harness-engineering/commit/d1395cb5f9fde664f96110dd3689082cc8509011))
* **014:** T009+T010 scaffold emits folder-form packages + starter instructions.md ([f29e44d](https://github.com/AI-Substrate/harness-engineering/commit/f29e44d7060bd96c9b33975dda315234b3cbf66b))
* **014:** T012 validate-harness-flow becomes a little package with authored briefing ([39df3fb](https://github.com/AI-Substrate/harness-engineering/commit/39df3fb2d4091e45e3d58fde3ad461cc7b225fab))
* **014:** T013 validate-harnessability becomes a little package with authored briefing ([b3c57ce](https://github.com/AI-Substrate/harness-engineering/commit/b3c57ce5c1de9f61fdda7106f2e5db8f89d5895b))
* **015:** T001+T002 — observe capture service, buffer codec, shared temp relocation (RED→GREEN) ([421de53](https://github.com/AI-Substrate/harness-engineering/commit/421de5373963feae2dc7f4fd5ddab398881c7714))
* **015:** T003+T004 — observe act, registration, reserved name (RED→GREEN) ([e4a943a](https://github.com/AI-Substrate/harness-engineering/commit/e4a943af92e6e0bf8bba2f7a3e4fa85945e57f8b))
* **015:** T005+T006 — doctor temp-hygiene convention probe (RED→GREEN) ([3f1cee9](https://github.com/AI-Substrate/harness-engineering/commit/3f1cee9f00e2a6f6bedd57b33ef524d934593b07))
* **015:** T007+T008 — core briefing teaches capture + drain (RED→GREEN) ([b0cef6f](https://github.com/AI-Substrate/harness-engineering/commit/b0cef6f8a42d4e474e67acc4fc88901faec81020))
* **015:** T009-T011 — one friction-lifecycle skill, slug retired, docs regen ([b57d7b1](https://github.com/AI-Substrate/harness-engineering/commit/b57d7b1242ab0f7f2bff75e94830525acfdaa735))
* **016:** arch-check extension shell — preflight, exec, parse, envelope (T005) ([f6b3752](https://github.com/AI-Substrate/harness-engineering/commit/f6b3752b640a5d863128d3d0cb75a7a1247cc0da))
* **016:** commit root .dependency-cruiser.cjs — 7 hexagonal rules at warn (T002) ([8d72545](https://github.com/AI-Substrate/harness-engineering/commit/8d72545ee67342d14087d711ffd1e80b25879142))
* **016:** GREEN — pure mapToDecision(parsed, rules) envelope mapping (T004) ([9fe9a28](https://github.com/AI-Substrate/harness-engineering/commit/9fe9a28026c1496db195389b42e9a7641559172c))
* **017:** discovery emits POSIX logical paths — the single POSIX origin (T004) ([f588dcf](https://github.com/AI-Substrate/harness-engineering/commit/f588dcfd532baa5448a9beb98e9dd13f397a9814))
* **017:** doctor + instructions derive POSIX paths downstream of discovery (T006) ([db6e297](https://github.com/AI-Substrate/harness-engineering/commit/db6e29742fc06c1f2971963fa36d43135d8d03a7))
* **017:** FakeFs separator tolerance — canonical-POSIX state, tolerant probes (T003) ([a80a0b4](https://github.com/AI-Substrate/harness-engineering/commit/a80a0b48fda630ecc034bd6107cf586321ab78fc))
* **017:** POSIX path helper + Windows-shaped unit sensor (T001/T002) ([5e831a1](https://github.com/AI-Substrate/harness-engineering/commit/5e831a10c33d6ca9f476f731e02c50d836c71544))
* **017:** record + scaffold services emit POSIX logical paths (T005) ([3095fa8](https://github.com/AI-Substrate/harness-engineering/commit/3095fa8b7f846140f4f8039d56276b7e1e8e6e84))
* add engineering-harness-setup skill (v0.1) ([5a097cf](https://github.com/AI-Substrate/harness-engineering/commit/5a097cf91b2d2f9cff961d887a85503700ce580a))
* add harness boot and compound skills ([d4df1dd](https://github.com/AI-Substrate/harness-engineering/commit/d4df1ddc47f3b8693584a99574ddc3c0a3b74615))
* **cli:** add `--branch` to `harness skills install` (GitHub tree-URL translation) ([9b925c2](https://github.com/AI-Substrate/harness-engineering/commit/9b925c28564c363b27c45385748459226ced496a))
* **cli:** add E170 + pure npx-skills argv builder (T005,T006) ([ab472da](https://github.com/AI-Substrate/harness-engineering/commit/ab472dad9be71d6eec98c8c64a974bc8ca31313d))
* **cli:** harness skills install core command (T007) ([5f508f0](https://github.com/AI-Substrate/harness-engineering/commit/5f508f07d343de489be7913d13b56d1afde43751))
* **cli:** record act, doctor record-types, new --record scaffold (T011-T014) ([0295f22](https://github.com/AI-Substrate/harness-engineering/commit/0295f223f2acadc5f3fd95b9c6cb3b1d3e834304))
* **cli:** record-type contract, core retro type, record service + registry (T001-T006,T010) ([d29a650](https://github.com/AI-Substrate/harness-engineering/commit/d29a6504ad0dcc9ca44615f506372251a62837c9))
* **cli:** reserve 'skills' + surface it in help (T008) ([7723a9e](https://github.com/AI-Substrate/harness-engineering/commit/7723a9e3585621c4f9bd139c1a5929a796bea14d))
* **cli:** separate extensions in --help under their own colored section ([6662813](https://github.com/AI-Substrate/harness-engineering/commit/66628133a1690c8f7e76f193cd2c1643fc03bed2))
* **cli:** widen extension loader to route kind:'record' exports (T007-T009) ([5b48db7](https://github.com/AI-Substrate/harness-engineering/commit/5b48db7af8dd268553a0c06609e35bff8b2f0eff))
* **docs:** add curated doc allow-list manifest (T003) ([0d2b567](https://github.com/AI-Substrate/harness-engineering/commit/0d2b567ef27625b3b9ad991ab88a22658c7d3874))
* **docs:** add E160 DOC_NOT_FOUND error code (T002) ([3247d65](https://github.com/AI-Substrate/harness-engineering/commit/3247d65a81dc1b4c98f5180205023caf222d1c11))
* **docs:** add MCP-stable docs contract types (T001) ([e9dc5b1](https://github.com/AI-Substrate/harness-engineering/commit/e9dc5b18d6a10fe47c7682872ea2b1468f8ce9e4))
* **docs:** advertise docs in help surface (T012) ([842ac20](https://github.com/AI-Substrate/harness-engineering/commit/842ac200285a372fc1c5ead7bf7040954ee80db1))
* **docs:** pure DocsService listDocs/getDoc (T008) ([3b302db](https://github.com/AI-Substrate/harness-engineering/commit/3b302dbe63cf3f28b389ee3920cd3b8e0257a907))
* **docs:** register docs command in composition root (T010) ([856da03](https://github.com/AI-Substrate/harness-engineering/commit/856da03d7aceeb15f4a7fef8e3fea51f59c0896f))
* **docs:** registerDocsAct + EPIPE-safe entrypoint (T009) ([88f48cf](https://github.com/AI-Substrate/harness-engineering/commit/88f48cf80511b9ddf8f6037aecaf65eaa2e1a435))
* **docs:** reserve docs as a core command name (T011) ([80c9d63](https://github.com/AI-Substrate/harness-engineering/commit/80c9d63a556cfbc5ee4945e6c7a603b07f8f6556))
* **eng-harness-flow:** author stateless router SKILL.md (T001-T003) ([a840a0b](https://github.com/AI-Substrate/harness-engineering/commit/a840a0b08c9def14ff170ad5fa06d136e8214c67))
* **eng-harness-flow:** register skill in .minih.json include (T006) ([32529fb](https://github.com/AI-Substrate/harness-engineering/commit/32529fb5fd7113a928db9dbd427f832bb3bc5778))
* **eng-harness-flow:** ship governance-doc + maturity-assessment references (T004-T005) ([e45d658](https://github.com/AI-Substrate/harness-engineering/commit/e45d658e9c9cebb9520b67d34e6848fe5e7a0c7d))
* **harness-cli:** add ExecPort + NodeExec + FakeExec (T003/T004) ([693d6cd](https://github.com/AI-Substrate/harness-engineering/commit/693d6cdfde15f262ec98f2cd2ecb4b541e8f7a93))
* **harness-cli:** add extension discovery service (T007/T008) ([9170c5f](https://github.com/AI-Substrate/harness-engineering/commit/9170c5f3cb1730f0d561bc2a9e4798331e84d66c))
* **harness-cli:** add extension error codes E140/E141/E142 (T018) ([7776b8c](https://github.com/AI-Substrate/harness-engineering/commit/7776b8cdbbe37498bb090fdee3769901a83ef2db))
* **harness-cli:** add FsPort.readdir + ProcessPort.cwd (T001/T002) ([c55c995](https://github.com/AI-Substrate/harness-engineering/commit/c55c9958c9bdeb58f6d655f1015df2eb5012ee35))
* **harness-cli:** add ModuleLoaderPort + JitiLoader + FakeModuleLoader (T005) ([bf24b20](https://github.com/AI-Substrate/harness-engineering/commit/bf24b20d8a5080069e193512ddb224a610b20b7a))
* **harness-cli:** add public verb contract module (T006) ([496601e](https://github.com/AI-Substrate/harness-engineering/commit/496601eac39505f94e2f03610d859293e72acbed))
* **harness-cli:** add registerVerbAct (T013/T014) ([ab34d94](https://github.com/AI-Substrate/harness-engineering/commit/ab34d94f55c94bae562e10288cb45938180d0f63))
* **harness-cli:** add verb registry + validateVerbRegistry (T009/T010) ([df8f5ae](https://github.com/AI-Substrate/harness-engineering/commit/df8f5ae5e3ab02d293d18d0698d4a1370ba2aa50))
* **harness-cli:** add verb-context builder + finalizer + runVerb (T011/T012) ([5cdce62](https://github.com/AI-Substrate/harness-engineering/commit/5cdce62e0ef0cc0860f1f12f19537a35ebfd24b0))
* **harness-cli:** add write capability to FsPort (mkdirp + writeText) ([fb52058](https://github.com/AI-Substrate/harness-engineering/commit/fb520587adc9855742e0e3403d3f6a4384273f68))
* **harness-cli:** async composition root loads extensions before parse (T015/T016) ([ce1e914](https://github.com/AI-Substrate/harness-engineering/commit/ce1e914341c5ad622d595c4bb64bb899b2b2cc6d))
* **harness-cli:** doctor enumerates extensions (core command) (T021/T022) ([796267f](https://github.com/AI-Substrate/harness-engineering/commit/796267f9aae5fb23d7bf4fcdcd26c5adbcbd70de))
* **harness-cli:** make help dynamic + extension-aware (T019/T020) ([a111ad2](https://github.com/AI-Substrate/harness-engineering/commit/a111ad21ae6f585d0d135810c2c2b4c7afbec14b))
* **harness-cli:** scaffold service (validate, root via ProcessPort, write) ([3eb9c24](https://github.com/AI-Substrate/harness-engineering/commit/3eb9c249fb7d9b8c6e88ec491d938e31e190e6d2))
* **harness-cli:** scaffold templates + E15x codes + reserve 'new' ([93ab4c1](https://github.com/AI-Substrate/harness-engineering/commit/93ab4c1bba0d501b5fd42e5fcc923d580edf0ddc))
* **harness-cli:** T001 — fs adapter (port/node/fake) ([7194874](https://github.com/AI-Substrate/harness-engineering/commit/7194874451c364668d07e661cfed3af2e61ed6fd))
* **harness-cli:** T001 — root package.json + tsconfig scaffold ([09c2e4c](https://github.com/AI-Substrate/harness-engineering/commit/09c2e4c2cb7a4a1636890c4b0b399a573cd1caeb))
* **harness-cli:** T002 — process adapter (port/node/fake) ([5597cb9](https://github.com/AI-Substrate/harness-engineering/commit/5597cb9ee84ee5ff75efe4d1d32e5d89a2e63db4))
* **harness-cli:** T002 — root biome.json (format + lint) ([17ca8d5](https://github.com/AI-Substrate/harness-engineering/commit/17ca8d5209d14bcc1210ea2cee1f855fc7823aab))
* **harness-cli:** T003 — git adapter (port/exec/fake) ([9bb53e2](https://github.com/AI-Substrate/harness-engineering/commit/9bb53e24bae6da75327be76d70ff256d4735948f))
* **harness-cli:** T003 — vitest config with v8 coverage (report-only) ([1faaca9](https://github.com/AI-Substrate/harness-engineering/commit/1faaca9f279a30eb115179783b0109cac924c7cb))
* **harness-cli:** T004 — env adapter (port/node/fake) ([971095c](https://github.com/AI-Substrate/harness-engineering/commit/971095c0cae6627c979265c91d39ef54b9f17a01))
* **harness-cli:** T004 — justfile fix/format/test/fft loop ([39b7df2](https://github.com/AI-Substrate/harness-engineering/commit/39b7df2026c3c3a28524f268ab9f2785e8bb9e1f))
* **harness-cli:** T005 — Clock adapter (port/system/fake) ([1fcc289](https://github.com/AI-Substrate/harness-engineering/commit/1fcc2894196818c3920e63cbc641ef921beb4677))
* **harness-cli:** T005 — slot registry + unconfigured-slot factory act ([b41647b](https://github.com/AI-Substrate/harness-engineering/commit/b41647beb87e44c0d7cffcfe3cc3269050bdfd48))
* **harness-cli:** T006 — help service + act (machine-readable) ([b3f1ca6](https://github.com/AI-Substrate/harness-engineering/commit/b3f1ca6888354325d43a2e95cb3e546a311ecacf))
* **harness-cli:** T007 — doctor service + act (test-first, layered) ([6380bac](https://github.com/AI-Substrate/harness-engineering/commit/6380bac6e023c01fd9b022aa83d34565c7510a4e))
* **harness-cli:** T007 — output kernel envelope/error-codes/exit (green) ([e2dffe0](https://github.com/AI-Substrate/harness-engineering/commit/e2dffe09a9348c329539eb8b299b497b36710a8b))
* **harness-cli:** T008 — command-map validation (E120) ([7749b5c](https://github.com/AI-Substrate/harness-engineering/commit/7749b5c77ede5af414234b5cdcfb14ec9176b116))
* **harness-cli:** T008 — OutputPort selectMode + JSON/human renderers ([2512b17](https://github.com/AI-Substrate/harness-engineering/commit/2512b1736936c2796ca253c13e62e0546a065b3c))
* **harness-cli:** T009 — entrypoint composition root (tri-state json, all acts) ([423762d](https://github.com/AI-Substrate/harness-engineering/commit/423762d47e05c45d44bab201b6f33841d6254a94))
* **harness-cli:** T009 — minimal entrypoint + npx wiring smoke (Phase 1 landed) ([d9f6435](https://github.com/AI-Substrate/harness-engineering/commit/d9f6435bf5481037206c50d72267196f3aeac858))
* **harness-cli:** T010 — actionable errors, no raw stack traces ([db0b664](https://github.com/AI-Substrate/harness-engineering/commit/db0b66443722a6e2701731487748754d7aa88299))
* **harness-cli:** the `new` core command (act + wiring + help) ([ca3e108](https://github.com/AI-Substrate/harness-engineering/commit/ca3e108ba032ae2970642eeefb10e754cda88046))
* **harness:** skills-check extension + fix over-limit skill descriptions ([7d6d5fa](https://github.com/AI-Substrate/harness-engineering/commit/7d6d5fab40d531b0bd543e4b7234790ee722e306))
* **record:** place records under &lt;date&gt;/&lt;NNN&gt;-&lt;slug&gt;.md (per-day ordinal) ([2b48f6b](https://github.com/AI-Substrate/harness-engineering/commit/2b48f6b8da1a329dc7143dae25292f83cd4f6619))
* **release:** canary job self-verifies authed install + latest untouched (AC-11) ([ff62965](https://github.com/AI-Substrate/harness-engineering/commit/ff62965fce88b82d80ea022452d30bac8550d918))
* **release:** publish CLI to GitHub Packages via release-please (plan 018) ([29e4255](https://github.com/AI-Substrate/harness-engineering/commit/29e4255b09fd2a8f2834c91f487cba6247c783df))
* **scaffold:** enrich --wrap boot Envelope with duration + stdout tail ([0aad609](https://github.com/AI-Substrate/harness-engineering/commit/0aad609c1f112d42e03a675be4bcafd7b5f1939f))
* **skill+docs:** add-extension skill, docs/how guide, reusable test-repo ([a9da29d](https://github.com/AI-Substrate/harness-engineering/commit/a9da29dd1a1036345183d55d220a9659eba7c400))
* **skills:** eng-harness-flow rail v2 — the-flow glyph language + unified dual-flow block ([e7cf167](https://github.com/AI-Substrate/harness-engineering/commit/e7cf16764ad7d0b4447ad5ba98ce778daf27e5a2))
* **skills:** import 4 harness-loop skills into eng-harness-loop (T001) ([eb1f81f](https://github.com/AI-Substrate/harness-engineering/commit/eb1f81f83036cdcfc9e89dc30bb7deb357670587))
* Starter Harness CLI Core (harness/cli) — npx CLI + engineering substrate + CI/release/protection ([e9392dd](https://github.com/AI-Substrate/harness-engineering/commit/e9392dd39000866f5187eef3683662b878318e48))


### Bug Fixes

* **008:** address companion T001 findings F001 (report-dir fallback) + F002 (npx harness) ([38a9975](https://github.com/AI-Substrate/harness-engineering/commit/38a9975ee65e329d761bb6235c8ae4322e9ad474))
* **008:** realign README to post-fix contract (companion F003/F004) ([dc20748](https://github.com/AI-Substrate/harness-engineering/commit/dc20748a77ab47e01315e40fe32e99271c05094d))
* **009:** address companion review findings F004 (HIGH) + F002 + F001 ([371e6a9](https://github.com/AI-Substrate/harness-engineering/commit/371e6a92c8ca46d88c239ec399f210ded10761e3))
* **013/FX004:** de-leak worker rules — 8 rails stay, product knowledge goes ([469fc6b](https://github.com/AI-Substrate/harness-engineering/commit/469fc6b5a04c1d8896412e97e87a86d09ff355b8))
* **013/FX004:** drop governance from the worker report schema ([154dddc](https://github.com/AI-Substrate/harness-engineering/commit/154dddca21e3830b6bf3c5253789ef65149a95e6))
* **013/FX004:** mount the full 7-skill surface; grade clones with deterministic probes ([9074a62](https://github.com/AI-Substrate/harness-engineering/commit/9074a62204b2fd8eb555ff91ebb2d658ed1c06bb))
* **013/FX004:** refresh the two operator docs for the onboarding-experience test ([7d705eb](https://github.com/AI-Substrate/harness-engineering/commit/7d705eb6a853992f830145378ffc97c14c784143))
* **013/FX004:** replace worker runbook with goal-only onboarding brief; encode --prefix trap product-side ([5fa96b0](https://github.com/AI-Substrate/harness-engineering/commit/5fa96b064a0244ee2688ba07d0bba5aaacec2936))
* **013:** address code-review-companion findings F001-F008 ([0d3c4c2](https://github.com/AI-Substrate/harness-engineering/commit/0d3c4c2e308accec68ff05e11e1b070dfcfa490b))
* **014:** address code-review-companion farewell findings F001-F008 ([1a6d5c9](https://github.com/AI-Substrate/harness-engineering/commit/1a6d5c97c96ff93da92608b2e7c1a1045a35cac2))
* **014:** encode the orchestrator magic wand — cwd-independent suite + named stale-dist failure ([ce07241](https://github.com/AI-Substrate/harness-engineering/commit/ce0724120009f9d3fd2b2c86d9aef7d5ac05834b))
* **015:** address companion findings F001 + F003 ([21bdfcc](https://github.com/AI-Substrate/harness-engineering/commit/21bdfcc24c3a5949536030325c319a1b94f3bbb1))
* **016:** address companion farewell findings F001-F007 ([7dbd145](https://github.com/AI-Substrate/harness-engineering/commit/7dbd1458161b4839686c74f8fdca77f8412e56f6))
* **017:** address companion farewell findings F001-F004 + phase-end ceremony ([e1bc7b6](https://github.com/AI-Substrate/harness-engineering/commit/e1bc7b6f2cc0f39b9e11df575b08199f3cfeb5b3))
* **017:** committed executable bin wrapper — deterministic npx resolution in CI (T014) ([bd317e3](https://github.com/AI-Substrate/harness-engineering/commit/bd317e3aaf4132946074760e3ab02bd1d34ebd04))
* **017:** gen-docs logs to stderr + portable biome invocation (T010) ([52e80c4](https://github.com/AI-Substrate/harness-engineering/commit/52e80c4081c895b9de3c71681e289aec2351c1b3))
* **017:** POSIX-ify observe-service + temp; glob-ify AC-2 source guard ([fa5b02d](https://github.com/AI-Substrate/harness-engineering/commit/fa5b02db8c024ef6ca2f24bacbce5ffb140a95a8))
* **cli:** never-clobber exhaustion guard + E181 on temp/write permission failure ([5563b40](https://github.com/AI-Substrate/harness-engineering/commit/5563b406a6bfc1c88a23740dc8ebc1d8b52f35fb))
* **docs:** address companion findings F001-F005 ([a08fbe7](https://github.com/AI-Substrate/harness-engineering/commit/a08fbe7240847b4041da2651bd375aa700d3a65c))
* **doctor:** stop falsely reporting cli-build degraded in consumer mode ([b0613e1](https://github.com/AI-Substrate/harness-engineering/commit/b0613e13750cd28993b799ef0c1136d5d16886ff))
* **eng-harness-1-boot:** last deferred-writer residual in maturity intro (companion F005) ([f9f82cf](https://github.com/AI-Substrate/harness-engineering/commit/f9f82cfaf96a40c4bbc88f72c4dcfcd014b695fb))
* **harness-cli:** address companion findings F001-F003 ([7ce7b14](https://github.com/AI-Substrate/harness-engineering/commit/7ce7b1449934e1604b7a5de034564829646639a2))
* **harness-cli:** F001 — enforce next_action on degraded; unconfigured carries data ([dac64fa](https://github.com/AI-Substrate/harness-engineering/commit/dac64fae50ec3d7f148f6c60010cc071ba9441a0))
* **harness-cli:** F001 — ExecGit smoke accepts detached-HEAD (null branch) ([413ae98](https://github.com/AI-Substrate/harness-engineering/commit/413ae9813588aa9c18f860d136cea82889db292f))
* **harness-cli:** F002+F003 — run&lt;slot&gt; dispatcher + resolved CliIo into acts ([de58d83](https://github.com/AI-Substrate/harness-engineering/commit/de58d83641b8aed89a3543ffae8f3b3b08658dc8))
* **harness-cli:** F005 — bin works through npm/npx symlink (split app.ts) ([db39949](https://github.com/AI-Substrate/harness-engineering/commit/db399496963066accfd565424a3d6b6dab77ae41))
* **harness-cli:** F006 — keep process.exit confined to exit.ts ([7c8fae8](https://github.com/AI-Substrate/harness-engineering/commit/7c8fae8f0d5805d202cd951b99c950e394a0439b))
* **harness-cli:** guard NodeExec against synchronous spawn throw (F001) ([e240ec9](https://github.com/AI-Substrate/harness-engineering/commit/e240ec99589387860f6d0219d9623ce290945379))
* **harness-cli:** map invalid verb status to E141 + enforce non-blank next_action ([0853f56](https://github.com/AI-Substrate/harness-engineering/commit/0853f5690a2290e3538d43314fa9b13fd9203d35))
* **harness-cli:** record ALL shadowed verbs in a conflict, not just the first (F005) ([ca3f42a](https://github.com/AI-Substrate/harness-engineering/commit/ca3f42a3688d62f1f7331cb8189e496d528cb5a9))
* **harness-cli:** reject manifest entries that escape the extension subdir (F004) ([986aa8a](https://github.com/AI-Substrate/harness-engineering/commit/986aa8a12dba74176b0e533b47363c9d4c6d30f1))
* **harness-cli:** reject variadic args + validate arg/option shape (F008) ([79f7747](https://github.com/AI-Substrate/harness-engineering/commit/79f774771cbbbf0e2c67fb378b1454d880f06853))
* **harness-cli:** return default export only for native .js modules (F002) ([d54321b](https://github.com/AI-Substrate/harness-engineering/commit/d54321b5edfb62a4b35b192fc76574ef9c3eea36))
* **harness-cli:** variant-aware `harness new` next_action (MH-003) ([9db9a14](https://github.com/AI-Substrate/harness-engineering/commit/9db9a14b51d202759fbfab2859f4dbb18df52128))
* **harness:** resolve deferred-writer wording drift (companion F001-F004) ([c67d8b1](https://github.com/AI-Substrate/harness-engineering/commit/c67d8b1887efd8858a9969c148083781b6926e57))
* resolve 7 companion findings (F001-F007) ([20ae78e](https://github.com/AI-Substrate/harness-engineering/commit/20ae78ef42c15712af6b4623245cf8369652756f))
* **skills:** mandate fenced rail rendering + fixed anchored-line shape ([d892f55](https://github.com/AI-Substrate/harness-engineering/commit/d892f55825aabf6794761cfdfaa7b949f086cf78))


### Code Refactoring

* **harness-cli:** remove BUILTIN_SLOTS / run scaffolding (T017) ([370aabb](https://github.com/AI-Substrate/harness-engineering/commit/370aabbcc1b7f21e98e55c262451a2d059e259f1))
