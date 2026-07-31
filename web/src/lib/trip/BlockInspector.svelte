<script lang="ts">
	// Per-block inspector: the structured fields of one stop, in a panel anchored
	// to that stop (a bottom sheet below 960px).
	//
	// Phase 2 made every *text* field editable where it renders. The fields here
	// are the ones inline typing cannot express — a time, a money amount and its
	// category, a set of tags, coordinates, URLs. Keeping them in a focused panel
	// scoped to ONE block is the point: the alternative is the whole-trip form,
	// which is what this whole effort is moving away from.
	//
	// Labels come from the UI catalog (`t()`), not the trip-language `tripChrome`
	// catalog TripView uses internally: this is an authoring form rendered in the
	// top layer, not trip content, and every label it needs already exists from
	// the form editor.
	import type { Block, Trip, CostCategory } from '$lib/trip-engine';
	import PlaceSearch from '$lib/editor/PlaceSearch.svelte';
	import { t } from '$lib/i18n/store.svelte';

	let {
		block,
		trip,
		lang,
		onedit,
		onduplicate,
		onremove,
		onmove,
		canMoveUp = false,
		canMoveDown = false
	}: {
		block: Block;
		trip: Trip;
		/** Content language, for showing tag labels as the author sees them. */
		lang: string;
		onedit?: (structural?: boolean) => void;
		/** Structural actions on the whole stop. Also the keyboard-accessible
		 *  route to reordering — dragging the rail grip is pointer-only. */
		onduplicate?: () => void;
		onremove?: () => void;
		onmove?: (dir: -1 | 1) => void;
		canMoveUp?: boolean;
		canMoveDown?: boolean;
	} = $props();

	let seq = idCounter++;
	const panelId = `blk-inspect-${seq}`;
	let panelEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let open = $state(false);

	const tagKeys = $derived(trip.tags ? Object.keys(trip.tags) : []);
	const COST_CATEGORIES: CostCategory[] = ['lodging', 'food', 'transport', 'activities', 'shopping', 'other'];
	const catLabels = $derived<Record<CostCategory, string>>({
		lodging: t('block.cat.lodging'),
		food: t('block.cat.food'),
		transport: t('block.cat.transport'),
		activities: t('block.cat.activities'),
		shopping: t('block.cat.shopping'),
		other: t('block.cat.other')
	});

	// Any bubbling `input` means a bound field just wrote to the model — one
	// listener here saves wiring a handler onto every control. (A <select> fires
	// `input` too, so `change` isn't needed and would only add redundant saves
	// when a text field blurs unchanged.)
	function fieldChanged() {
		onedit?.();
	}

	function toggleTag(key: string) {
		// Assign first, then read `block.tags` back as the reactive proxy —
		// mutating the raw array assigned above wouldn't notify. (Same reason as
		// the form editor's BlockEditor.)
		if (!block.tags) block.tags = [];
		const list = block.tags;
		const i = list.indexOf(key);
		if (i === -1) list.push(key);
		else list.splice(i, 1);
		onedit?.();
	}

	// A cost is only valid with a positive amount, so clearing the amount drops
	// the whole object — a category on its own cannot validate.
	function setCostAmount(raw: string) {
		const v = raw === '' ? NaN : Number(raw);
		block.cost = v > 0 ? { amount: v, category: block.cost?.category } : undefined;
		onedit?.();
	}
	function setCostCategory(raw: string) {
		if (!block.cost) return;
		block.cost = { amount: block.cost.amount, category: raw === '' ? undefined : (raw as CostCategory) };
		onedit?.();
	}

	// lat/lon are independent while typing; a half-filled pair is dropped before
	// save by pruneEmpty, so a partial entry can never fail the schema.
	function setCoord(key: 'lat' | 'lon', raw: string) {
		const v = raw === '' ? undefined : Number(raw);
		const next = { ...(block.coords ?? {}), [key]: v };
		block.coords = next.lat === undefined && next.lon === undefined ? undefined : (next as never);
		onedit?.();
	}

	// Filling coords from a picked place never clobbers what the author already
	// wrote — the maps URL is only filled when empty.
	function onPickPlace(p: { name: string; lat: number; lon: number }) {
		block.coords = { lat: p.lat, lon: p.lon };
		if (!block.mapsUrl) block.mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(p.name)}`;
		onedit?.();
	}

	// ── Checklist ──
	// Only the existence of the list is managed here; its title and items are
	// edited in place on the stop itself, where they render.
	function addChecklist() {
		block.checklist = {
			title: Object.fromEntries(trip.languages.map((l) => [l, ''])),
			items: [{ text: Object.fromEntries(trip.languages.map((l) => [l, ''])), done: false }]
		};
		onedit?.(true);
	}
	function removeChecklist() {
		block.checklist = undefined;
		onedit?.(true);
	}

	// ── Photo spots ──
	// Four fields apiece (caption, maps URL, Wikipedia page, fallback image), so
	// these are inspector rows rather than inline text — editing only the caption
	// where it renders would leave the other three stranded.
	function addPhotoSpot() {
		if (!block.photoSpots) block.photoSpots = [];
		block.photoSpots.push({ name: '', mapsUrl: '' });
		onedit?.(true);
	}
	function removePhotoSpot(i: number) {
		block.photoSpots?.splice(i, 1);
		if (block.photoSpots && block.photoSpots.length === 0) block.photoSpots = undefined;
		onedit?.(true);
	}

	function addLink() {
		// Assign, then read `block.links` back before pushing: `(x ??= [])`
		// evaluates to the RAW array, and mutating that bypasses the $state proxy,
		// so the new row would never render. Same trap as toggleTag above.
		if (!block.links) block.links = [];
		block.links.push({ url: '' });
		onedit?.();
	}
	function removeLink(i: number) {
		block.links?.splice(i, 1);
		if (block.links && block.links.length === 0) block.links = undefined;
		onedit?.();
	}

	// ── Anchoring ──
	// The panel is a popover, so it lives in the top layer and can't be clipped
	// by the timeline's scroll containers. Below 960px CSS pins it as a bottom
	// sheet and this positioning is skipped entirely.
	const DESKTOP = '(min-width: 960px)';
	function isDesktop(): boolean {
		return typeof window !== 'undefined' && window.matchMedia(DESKTOP).matches;
	}
	function position() {
		if (!panelEl || !triggerEl || !isDesktop()) return;
		const r = triggerEl.getBoundingClientRect();
		const pw = panelEl.offsetWidth;
		const ph = panelEl.offsetHeight;
		const pad = 8;
		// Right-align to the trigger, then clamp inside the viewport.
		let left = Math.min(r.right - pw, window.innerWidth - pw - pad);
		left = Math.max(pad, left);
		// Below the trigger; flip above when there isn't room.
		let top = r.bottom + 6;
		if (top + ph > window.innerHeight - pad) top = Math.max(pad, r.top - ph - 6);
		panelEl.style.left = `${left}px`;
		panelEl.style.top = `${top}px`;
	}
	function onToggle(e: Event) {
		open = (e as ToggleEvent).newState === 'open';
		if (open) queueMicrotask(position);
	}
	// Keep the panel on its block while the timeline scrolls under it.
	$effect(() => {
		if (!open) return;
		let frame = 0;
		const onScrollOrResize = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				position();
			});
		};
		window.addEventListener('scroll', onScrollOrResize, true);
		window.addEventListener('resize', onScrollOrResize);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onScrollOrResize, true);
			window.removeEventListener('resize', onScrollOrResize);
		};
	});
</script>

<script lang="ts" module>
	// Unique popover ids. Only ever mounted client-side (edit mode starts off),
	// so there's no SSR/hydration ordering concern.
	let idCounter = 0;
</script>

<button
	bind:this={triggerEl}
	class="inspect-btn"
	class:on={open}
	popovertarget={panelId}
	aria-label={t('block.editDetails')}
	title={t('block.editDetails')}
>
	<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
</button>

<div bind:this={panelEl} id={panelId} popover="auto" class="inspector" ontoggle={onToggle} oninput={fieldChanged}>
	{#if open}
		<div class="ins-hd">
			<span class="ins-title">{t('block.editDetails')}</span>
			<button class="ins-close" popovertarget={panelId} popovertargetaction="hide" aria-label={t('tripbar.close')}>✕</button>
		</div>
		<div class="ins-body">
			<div class="grid2">
				<label class="f">{t('block.time')}<input type="text" bind:value={block.time} placeholder={t('block.timePlaceholder')} /></label>
				<label class="f">{t('block.walkKm')}<input type="number" step="0.1" min="0" bind:value={block.km} /></label>
			</div>

			{#if tagKeys.length}
				<div class="f">
					<span class="lbl">{t('block.tags')}</span>
					<div class="chips">
						{#each tagKeys as key (key)}
							<label class="chip" class:on={block.tags?.includes(key)}>
								<input type="checkbox" checked={block.tags?.includes(key)} onchange={() => toggleTag(key)} />
								{trip.tags?.[key].label?.[lang] ?? trip.tags?.[key].label?.[trip.defaultLanguage] ?? key}
							</label>
						{/each}
					</div>
				</div>
			{/if}

			<PlaceSearch label={t('block.findPlace')} onPick={onPickPlace} />

			<label class="f">{t('block.mapsUrl')}<input type="text" bind:value={block.mapsUrl} placeholder="https://maps.google.com/?q=..." /></label>

			<div class="grid2">
				<label class="f">{t('block.lat')}<input type="number" step="any" value={block.coords?.lat ?? ''} oninput={(e) => setCoord('lat', e.currentTarget.value)} /></label>
				<label class="f">{t('block.lon')}<input type="number" step="any" value={block.coords?.lon ?? ''} oninput={(e) => setCoord('lon', e.currentTarget.value)} /></label>
			</div>

			<div class="grid2">
				<label class="f">{t('block.costAmount')}<input type="number" step="0.01" min="0" value={block.cost?.amount ?? ''} oninput={(e) => setCostAmount(e.currentTarget.value)} /></label>
				<label class="f">{t('block.costCategory')}
					<select value={block.cost?.category ?? ''} onchange={(e) => setCostCategory(e.currentTarget.value)} disabled={!block.cost}>
						<option value="">{t('block.costCatNone')}</option>
						{#each COST_CATEGORIES as c (c)}<option value={c}>{catLabels[c]}</option>{/each}
					</select>
				</label>
			</div>

			<div class="f">
				<div class="sub-hd">
					<span class="lbl">{t('block.checklist')}</span>
					{#if block.checklist}
						<button type="button" class="mini danger" onclick={removeChecklist}>✕ {t('block.checklistRemove')}</button>
					{:else}
						<button type="button" class="mini" onclick={addChecklist}>+ {t('block.addChecklist')}</button>
					{/if}
				</div>
				{#if block.checklist}
					<p class="hintline">{t('block.checklistInlineHint')}</p>
				{/if}
			</div>

			<div class="f">
				<div class="sub-hd">
					<span class="lbl">{t('block.photoSpots')}</span>
					<button type="button" class="mini" onclick={addPhotoSpot}>+ {t('common.add')}</button>
				</div>
				{#each block.photoSpots ?? [] as ps, i (i)}
					<div class="spotrow">
						<input type="text" bind:value={ps.name} placeholder={t('block.captionPlaceholder')} aria-label={t('block.photoCaptionAria')} />
						<input type="text" bind:value={ps.mapsUrl} placeholder={t('block.photoMapsPlaceholder')} aria-label={t('block.photoMapsAria')} />
						<input type="text" bind:value={ps.wiki} placeholder={t('block.wikiPlaceholder')} aria-label={t('block.wikiAria')} />
						<input type="text" bind:value={ps.fallbackImg} placeholder={t('block.fallbackImgPlaceholder')} aria-label={t('block.fallbackImgAria')} />
						<button type="button" class="del spotdel" onclick={() => removePhotoSpot(i)} aria-label={t('block.removePhotoSpotAria')}>✕</button>
					</div>
				{/each}
			</div>

			<div class="f">
				<div class="sub-hd">
					<span class="lbl">{t('block.links')}</span>
					<button type="button" class="mini" onclick={addLink}>+ {t('common.add')}</button>
				</div>
				{#each block.links ?? [] as lk, i (i)}
					<div class="rowline">
						<input type="url" bind:value={lk.url} placeholder={t('block.linkUrlPlaceholder')} aria-label={t('block.linkUrlAria')} />
						<input type="text" bind:value={lk.label} placeholder={t('block.linkLabelPlaceholder')} aria-label={t('block.linkLabelAria')} />
						<button type="button" class="del" onclick={() => removeLink(i)} aria-label={t('block.removeLinkAria')}>✕</button>
					</div>
				{/each}
			</div>
		</div>

		<!-- Structural actions live here rather than as more icons on the stop
		     itself: they're rare, destructive-ish, and this panel is already the
		     "everything about this one stop" surface. Delete is undoable from the
		     toast it raises, so it doesn't ask for confirmation first. -->
		<div class="ins-actions">
			<button type="button" class="act" disabled={!canMoveUp} onclick={() => onmove?.(-1)} aria-label={t('block.moveUp')} title={t('block.moveUp')}>↑</button>
			<button type="button" class="act" disabled={!canMoveDown} onclick={() => onmove?.(1)} aria-label={t('block.moveDown')} title={t('block.moveDown')}>↓</button>
			<button type="button" class="act grow" onclick={() => onduplicate?.()} aria-label={t('block.duplicateAria')}>{t('day.duplicate')}</button>
			<button type="button" class="act danger" onclick={() => { panelEl?.hidePopover(); onremove?.(); }} aria-label={t('block.removeAria')}>{t('block.delete')}</button>
		</div>
	{/if}
</div>

<style>
	/* Trigger: same quiet 44px touch target as the maps affordance next to it. */
	.inspect-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
		border-radius: 50%;
	}
	@media (hover: hover) {
		.inspect-btn:hover {
			color: var(--accent-text);
			background: color-mix(in srgb, var(--accent-text) 8%, transparent);
		}
	}
	.inspect-btn.on {
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent-text) 14%, transparent);
	}

	.inspector {
		/* Popovers default to margin:auto + centred inset; positioning is ours. */
		margin: 0;
		padding: 0;
		/* The mobile sheet is width:100%; without this its 1px borders push it
		   2px past the viewport and both edges clip. */
		box-sizing: border-box;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--elevation-3);
		font-family: var(--font-ui);
		overflow: visible;
	}
	.inspector:popover-open {
		display: flex;
		flex-direction: column;
	}
	/* Mobile: a bottom sheet, which is also why none of the JS anchoring runs
	   below 960px. */
	@media (max-width: 959.98px) {
		.inspector {
			inset: auto 0 0 0;
			width: 100%;
			max-height: 80vh;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			border-bottom: none;
			/* Clear the bottom app bar. */
			padding-bottom: env(safe-area-inset-bottom);
		}
	}
	@media (min-width: 960px) {
		.inspector {
			position: fixed;
			inset: auto;
			width: 340px;
			max-height: 70vh;
		}
	}
	.inspector::backdrop {
		background: color-mix(in srgb, #000 28%, transparent);
	}
	@media (min-width: 960px) {
		/* No scrim on desktop — the panel is small and anchored, and dimming the
		   itinerary you are editing defeats the point of editing in place. */
		.inspector::backdrop {
			background: transparent;
		}
	}

	.ins-hd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 0.5rem 0.6rem 0.9rem;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.ins-title {
		font-size: 0.8rem;
		font-weight: 600;
	}
	.ins-close {
		border: none;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.9rem;
		width: 32px;
		height: 32px;
		border-radius: 50%;
	}
	@media (hover: hover) {
		.ins-close:hover {
			background: var(--surface-sunken);
			color: var(--text);
		}
	}
	.ins-body {
		overflow-y: auto;
		padding: 0.7rem 0.9rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.f {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--text-muted);
		min-width: 0;
	}
	.lbl {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.f :global(input),
	.f :global(select) {
		font-family: var(--font-ui);
		font-size: 0.85rem;
		color: var(--text);
		background: var(--surface-sunken);
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-md);
		padding: 0.35rem 0.5rem;
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.72rem;
		color: var(--text);
		background: var(--surface-sunken);
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-pill);
		padding: 0.15rem 0.5rem;
		cursor: pointer;
	}
	.chip.on {
		border-color: var(--accent-text);
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent-text) 10%, transparent);
	}
	.chip input {
		margin: 0;
	}
	.sub-hd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}
	.mini {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--accent-strong);
		background: none;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-button);
		padding: 0.1rem 0.45rem;
		cursor: pointer;
	}
	.rowline {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 0.3rem;
		align-items: center;
		margin-bottom: 0.3rem;
	}
	/* Photo spots stack their four fields, since two of them are URLs and would
	   be unreadable squeezed into a 340px row. */
	.spotrow {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.25rem 0.3rem;
		align-items: start;
		margin-bottom: 0.5rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px dashed var(--hairline);
	}
	.spotrow input {
		grid-column: 1;
	}
	.spotdel {
		grid-column: 2;
		grid-row: 1 / -1;
		align-self: start;
	}
	.hintline {
		margin: 0;
		font-size: 0.7rem;
		color: var(--text-muted);
	}
	.mini.danger {
		color: var(--warn-fg);
		border-color: color-mix(in srgb, var(--warn-bar) 50%, transparent);
	}
	.rowline input,
	.spotrow input {
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--text);
		background: var(--surface-sunken);
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-md);
		padding: 0.3rem 0.45rem;
		min-width: 0;
	}
	.del {
		border: none;
		background: none;
		color: var(--warn-fg);
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.2rem 0.3rem;
	}
	.ins-actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.9rem;
		border-top: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.act {
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: var(--accent-strong);
		background: var(--surface);
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-button);
		padding: 0.3rem 0.6rem;
		cursor: pointer;
		min-height: 32px;
	}
	.act.grow {
		flex: 1;
	}
	.act:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.act.danger {
		color: var(--warn-fg);
		border-color: color-mix(in srgb, var(--warn-bar) 50%, transparent);
	}
	@media (hover: hover) {
		.act:not(:disabled):hover {
			border-color: var(--accent-text);
		}
		.act.danger:not(:disabled):hover {
			border-color: var(--warn-bar);
			background: var(--warn-bg);
		}
	}
</style>
