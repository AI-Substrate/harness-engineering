# Original ask — gitai-collector-v1
**Captured**: 2026-08-06  ·  **By**: /builder

> okay so here is hte plan. Git AI will be the collector. ANd in v1 we will detect
> and install it, install hooks etc in doctor. It will start collecting. V1 removes
> *all* our telmery stuff. No semantic stuff etc in v1... just Git AI. THen v2 later
> we come back in and using git ai data as the source we can build up the data on
> top if the git ai richer data (that is local only) and ship our data in their
> formats adjacent.

> in v1 we will just disable our telemery collection, rather than cut itout. then we
> can migrate it easier later. makes v1 really simple

> it will be disabled by default though, not via env var... so its didabled when
> shipps. dr can also cehck the git ai daemon is running right?

> fleet lineage goes dark yes until v2 of this.

> It will work from pinned release of giait to prevent suplly chain attacks as well
> as format drift.

> not saying will bundle. is it possible we pin a version and pin sha and check it
> before install?

> then use our own download and valication rpocess (cross platform of course!)

> make it so we can shift the version and sha easily if we want to take an upgrad.
