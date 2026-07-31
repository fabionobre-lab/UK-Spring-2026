<script lang="ts">
	// Per-segment inspector: the segment-level fields that aren't free text
	// (theme, custom colours, weather location, default plan, id) plus the
	// structural actions on the segment. Third instance of the pattern the block
	// and the day already use — trigger in the hero, native popover, anchored
	// panel on desktop and a bottom sheet below 960px.
	import { type Trip, type Segment, tripTimezone } from '$lib/trip-engine';
	import { THEME_NAMES, slugifyId } from '$lib/editor/factories';
	import PlaceSearch from '$lib/editor/PlaceSearch.svelte';
	import { t } from '$lib/i18n/store.svelte';

	let {
		trip,
		seg,
		onedit,
		oninsert,
		onduplicate,
		onremove,
		onmove,
		canMoveUp = false,
		canMoveDown = false,
		canRemove = false
	}: {
		trip: Trip;
		seg: Segment;
		onedit?: (structural?: boolean) => void;
		oninsert?: () => void;
		onduplicate?: () => void;
		onremove?: () => void;
		onmove?: (dir: -1 | 1) => void;
		canMoveUp?: boolean;
		canMoveDown?: boolean;
		/** False on the trip's last remaining segment — the schema requires one. */
		canRemove?: boolean;
	} = $props();

	let panelEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let open = $state(false);
	const panelId = `seg-inspect-${idCounter++}`;

	function fieldChanged() {
		onedit?.();
	}

	// The segment id is an internal key (plan selection is stored against it);
	// it is slugified as you type so it can't leave the schema's
	// ^[a-z0-9][a-z0-9_-]*$ shape by accident. Emptying it is still invalid, and
	// surfaces through the usual "not saved yet" state rather than being blocked.
	function setId(raw: string) {
		seg.id = slugifyId(raw);
		onedit?.(true);
	}

	// ── Custom theme colours ──
	// Each is optional and hex-patterned, so clearing must remove the key rather
	// than blank it, and an empty themeColors object is dropped entirely.
	type ColorKey = 'heroBg' | 'accent' | 'eyebrow';
	function setThemeColor(key: ColorKey, value: string) {
		seg.themeColors = { ...(seg.themeColors ?? {}), [key]: value };
		onedit?.();
	}
	function clearThemeColor(key: ColorKey) {
		if (!seg.themeColors) return;
		const next = { ...seg.themeColors };
		delete next[key];
		seg.themeColors = Object.keys(next).length ? next : undefined;
		onedit?.();
	}
	const COLOR_KEYS: ReadonlyArray<[ColorKey, string]> = [
		['heroBg', 'seg.headerBg'],
		['accent', 'seg.accent'],
		['eyebrow', 'seg.eyebrow']
	];

	// ── Weather ──
	// lat, lon and granularity are required together, so the whole object is
	// created and removed as a unit rather than field by field.
	const hasWeather = $derived(!!seg.weather);
	function toggleWeather(on: boolean) {
		seg.weather = on
			? { lat: 0, lon: 0, granularity: 'daily', timezone: tripTimezone(trip) }
			: undefined;
		onedit?.(true);
	}
	function onPickPlace(p: { name: string; lat: number; lon: number }) {
		if (!seg.weather) return;
		seg.weather.lat = p.lat;
		seg.weather.lon = p.lon;
		onedit?.();
	}

	function setDefaultPlan(raw: string) {
		seg.defaultPlan = raw === '' ? undefined : raw;
		onedit?.(true);
	}

	function position() {
		if (!panelEl || !triggerEl || !window.matchMedia('(min-width: 960px)').matches) return;
		const r = triggerEl.getBoundingClientRect();
		const pw = panelEl.offsetWidth;
		const ph = panelEl.offsetHeight;
		const pad = 8;
		let left = Math.min(r.right - pw, window.innerWidth - pw - pad);
		left = Math.max(pad, left);
		let top = r.bottom + 6;
		if (top + ph > window.innerHeight - pad) top = Math.max(pad, r.top - ph - 6);
		panelEl.style.left = `${left}px`;
		panelEl.style.top = `${top}px`;
	}
	function onToggle(e: Event) {
		open = (e as ToggleEvent).newState === 'open';
		if (open) queueMicrotask(position);
	}
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
	let idCounter = 0;
</script>

<button
	bind:this={triggerEl}
	class="seg-inspect-btn"
	class:on={open}
	popovertarget={panelId}
	aria-label={t('seg.editDetails')}
	title={t('seg.editDetails')}
>
	<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
</button>

<div bind:this={panelEl} id={panelId} popover="auto" class="inspector" ontoggle={onToggle} oninput={fieldChanged}>
	{#if open}
		<div class="ins-hd">
			<span class="ins-title">{t('seg.editDetails')}</span>
			<button class="ins-close" popovertarget={panelId} popovertargetaction="hide" aria-label={t('tripbar.close')}>✕</button>
		</div>
		<div class="ins-body">
			<label class="f">{t('seg.theme')}
				<select bind:value={seg.theme} onchange={() => onedit?.()}>
					{#each THEME_NAMES as name (name)}<option value={name}>{name}</option>{/each}
				</select>
			</label>

			<div class="f">
				<span class="lbl">{t('seg.customColors')}</span>
				{#each COLOR_KEYS as [key, labelKey] (key)}
					<div class="colorrow">
						<span class="colorlbl">{t(labelKey as never)}</span>
						<input
							type="color"
							value={seg.themeColors?.[key] ?? '#8a8a8a'}
							oninput={(e) => setThemeColor(key, e.currentTarget.value)}
							aria-label={t(labelKey as never)}
						/>
						{#if seg.themeColors?.[key]}
							<button type="button" class="mini" onclick={() => clearThemeColor(key)}>{t('block.dotColorClear')}</button>
						{:else}
							<span class="hintline">{t('block.dotColorDefault')}</span>
						{/if}
					</div>
				{/each}
			</div>

			<div class="f">
				<label class="check"><input type="checkbox" checked={hasWeather} onchange={(e) => toggleWeather(e.currentTarget.checked)} /> {t('seg.liveWeather')}</label>
				{#if seg.weather}
					<PlaceSearch label={t('seg.findPlaceLatLon')} onPick={onPickPlace} />
					<div class="grid2">
						<label class="f">{t('block.lat')}<input type="number" step="any" bind:value={seg.weather.lat} /></label>
						<label class="f">{t('block.lon')}<input type="number" step="any" bind:value={seg.weather.lon} /></label>
					</div>
					<div class="grid2">
						<label class="f">{t('seg.granularity')}
							<select bind:value={seg.weather.granularity} onchange={() => onedit?.()}>
								<option value="daily">{t('common.daily')}</option>
								<option value="hourly">{t('common.hourly')}</option>
							</select>
						</label>
						<label class="f">{t('seg.timezone')}<input type="text" bind:value={seg.weather.timezone} placeholder="Europe/London" /></label>
					</div>
				{/if}
			</div>

			{#if seg.plans.length > 1}
				<label class="f">{t('seg.defaultPlan')}
					<select value={seg.defaultPlan ?? ''} onchange={(e) => setDefaultPlan(e.currentTarget.value)}>
						<option value="">{seg.plans[0].id}</option>
						{#each seg.plans as p (p.id)}<option value={p.id}>{p.id}</option>{/each}
					</select>
				</label>
			{/if}

			<label class="f">{t('seg.segmentId')} <span class="hintline">{t('seg.internalKey')}</span>
				<input type="text" value={seg.id} oninput={(e) => setId(e.currentTarget.value)} placeholder={t('seg.autoPlaceholder')} />
			</label>
		</div>

		<div class="ins-actions">
			<button type="button" class="act" disabled={!canMoveUp} onclick={() => onmove?.(-1)} aria-label={t('seg.moveUp')} title={t('seg.moveUp')}>↑</button>
			<button type="button" class="act" disabled={!canMoveDown} onclick={() => onmove?.(1)} aria-label={t('seg.moveDown')} title={t('seg.moveDown')}>↓</button>
			<button type="button" class="act" onclick={() => oninsert?.()}>+ {t('seg.addSegment')}</button>
			<button type="button" class="act" onclick={() => onduplicate?.()}>{t('day.duplicate')}</button>
			<button
				type="button"
				class="act danger"
				disabled={!canRemove}
				onclick={() => {
					panelEl?.hidePopover();
					onremove?.();
				}}
				aria-label={t('seg.remove')}>{t('block.delete')}</button
			>
		</div>
	{/if}
</div>

<style>
	/* Sits on the hero's theme-coloured band, beside the segment title. */
	.seg-inspect-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: none;
		color: rgba(255, 255, 255, 0.7);
		cursor: pointer;
		border-radius: 50%;
	}
	@media (hover: hover) {
		.seg-inspect-btn:hover {
			color: #fff;
			background: rgba(255, 255, 255, 0.14);
		}
	}
	.seg-inspect-btn.on {
		color: #fff;
		background: rgba(255, 255, 255, 0.2);
	}

	.inspector {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--elevation-3);
		font-family: var(--font-ui);
	}
	.inspector:popover-open {
		display: flex;
		flex-direction: column;
	}
	@media (max-width: 959.98px) {
		.inspector {
			inset: auto 0 0 0;
			width: 100%;
			max-height: 80vh;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			border-bottom: none;
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
		.inspector::backdrop {
			background: transparent;
		}
	}
	.inspector::backdrop {
		background: color-mix(in srgb, #000 28%, transparent);
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
		margin-top: 0.3rem;
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
	.colorrow {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.colorlbl {
		flex: 1;
		font-size: 0.75rem;
		color: var(--text);
	}
	.colorrow input[type='color'] {
		width: 2.4rem;
		height: 1.9rem;
		padding: 2px;
		flex-shrink: 0;
		cursor: pointer;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.check input {
		width: auto;
	}
	.hintline {
		font-size: 0.7rem;
		color: var(--text-muted);
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
		flex-shrink: 0;
	}
	.ins-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.5rem 0.9rem;
		border-top: 1px solid var(--hairline);
		flex-shrink: 0;
		flex-wrap: wrap;
	}
	.act {
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: var(--accent-strong);
		background: var(--surface);
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-button);
		padding: 0.3rem 0.55rem;
		cursor: pointer;
		min-height: 32px;
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
