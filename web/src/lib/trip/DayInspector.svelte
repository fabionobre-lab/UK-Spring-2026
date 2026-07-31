<script lang="ts">
	// Per-day inspector: the day-level fields that aren't free text, plus the
	// structural actions on the day itself. The same shape as BlockInspector one
	// level up — trigger in the day header, native popover, anchored panel on
	// desktop and a bottom sheet below 960px.
	//
	// Insertion lives in this panel's footer rather than in the day nav, because
	// the horizontal day strip is hidden at >=960px (the sidebar rail takes over)
	// and a "+" there would be invisible on desktop.
	import type { Day, Plan } from '$lib/trip-engine';
	import { t } from '$lib/i18n/store.svelte';

	let {
		day,
		plan,
		photoCount = 0,
		onedit,
		oninsert,
		onduplicate,
		onremove,
		onmove,
		canMoveUp = false,
		canMoveDown = false,
		canRemove = false
	}: {
		day: Day;
		/** The day's plan — for sibling context (ordering, the last-day guard). */
		plan: Plan;
		/** Photos currently placed on this day; drives the re-dating warning. */
		photoCount?: number;
		onedit?: (structural?: boolean) => void;
		oninsert?: () => void;
		onduplicate?: () => void;
		onremove?: () => void;
		onmove?: (dir: -1 | 1) => void;
		canMoveUp?: boolean;
		canMoveDown?: boolean;
		/** False on a plan's last remaining day — the schema requires one. */
		canRemove?: boolean;
	} = $props();

	let panelEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let open = $state(false);
	// Stable for the component's lifetime. It must NOT derive from anything on
	// the day (the date, say) — this panel edits the date, and an id that changed
	// underneath would break the trigger's popovertarget association mid-edit.
	const panelId = `day-inspect-${idCounter++}`;

	const ROUTE_MODES = ['walking', 'driving', 'transit', 'bicycling'] as const;
	const routeLabels = $derived<Record<(typeof ROUTE_MODES)[number], string>>({
		walking: t('day.walking'),
		driving: t('day.driving'),
		transit: t('day.transit'),
		bicycling: t('day.bicycling')
	});

	function fieldChanged() {
		onedit?.();
	}
	function setRouteMode(raw: string) {
		day.routeMode = raw === '' ? undefined : raw;
		onedit?.();
	}
	const hasStaticWx = $derived(!!day.staticWeather);
	function toggleStaticWx(on: boolean) {
		// hi/lo are both required by the schema, so the pair is created together.
		day.staticWeather = on ? { hi: 0, lo: 0, emoji: '☀️' } : undefined;
		onedit?.(true);
	}

	// The day nav synthesises the free days between planned ones by date
	// arithmetic, and silently gives up when the dates aren't in order. Re-dating
	// a day here is the one way to cause that, so say so rather than let the nav
	// quietly change shape.
	const datesOutOfOrder = $derived.by(() => {
		const dates = plan.days.map((d) => d.date).filter(Boolean);
		return dates.some((d, i) => i > 0 && dates[i - 1] > d);
	});

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
	class="day-inspect-btn"
	class:on={open}
	popovertarget={panelId}
	aria-label={t('day.editDetails')}
	title={t('day.editDetails')}
>
	<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
</button>

<div
	bind:this={panelEl}
	id={panelId}
	popover="auto"
	class="inspector"
	ontoggle={onToggle}
	oninput={fieldChanged}
>
	{#if open}
		<div class="ins-hd">
			<span class="ins-title">{t('day.editDetails')}</span>
			<button class="ins-close" popovertarget={panelId} popovertargetaction="hide" aria-label={t('tripbar.close')}>✕</button>
		</div>
		<div class="ins-body">
			<label class="f">{t('day.dateIso')}<input type="date" bind:value={day.date} /></label>
			{#if photoCount > 0}
				<p class="warnline">{t('day.photosWarning', { count: photoCount })}</p>
			{/if}
			{#if datesOutOfOrder}
				<p class="warnline">{t('day.datesOutOfOrder')}</p>
			{/if}

			<div class="grid2">
				<label class="f">{t('day.routeMode')}
					<select value={day.routeMode ?? ''} onchange={(e) => setRouteMode(e.currentTarget.value)}>
						<option value="">{t('day.routeNone')}</option>
						{#each ROUTE_MODES as m (m)}<option value={m}>{routeLabels[m]}</option>{/each}
					</select>
				</label>
				<label class="f">{t('day.kmOverride')}<input type="number" step="0.1" min="0" bind:value={day.kmTotal} /></label>
			</div>

			<div class="f">
				<label class="check"><input type="checkbox" checked={hasStaticWx} onchange={(e) => toggleStaticWx(e.currentTarget.checked)} /> {t('day.storedWeather')}</label>
				{#if day.staticWeather}
					<div class="grid3">
						<label class="f">{t('day.highC')}<input type="number" bind:value={day.staticWeather.hi} /></label>
						<label class="f">{t('day.lowC')}<input type="number" bind:value={day.staticWeather.lo} /></label>
						<label class="f">{t('day.emoji')}<input type="text" bind:value={day.staticWeather.emoji} /></label>
					</div>
				{/if}
			</div>
		</div>

		<div class="ins-actions">
			<button type="button" class="act" disabled={!canMoveUp} onclick={() => onmove?.(-1)} aria-label={t('day.moveUp')} title={t('day.moveUp')}>↑</button>
			<button type="button" class="act" disabled={!canMoveDown} onclick={() => onmove?.(1)} aria-label={t('day.moveDown')} title={t('day.moveDown')}>↓</button>
			<button type="button" class="act" onclick={() => oninsert?.()}>+ {t('day.addDay')}</button>
			<button type="button" class="act" onclick={() => onduplicate?.()} aria-label={t('day.duplicateAria')}>{t('day.duplicate')}</button>
			<button
				type="button"
				class="act danger"
				disabled={!canRemove}
				onclick={() => {
					panelEl?.hidePopover();
					onremove?.();
				}}
				aria-label={t('day.removeAria')}>{t('block.delete')}</button
			>
		</div>
	{/if}
</div>

<style>
	.day-inspect-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: none;
		/* Sits on the theme-coloured day header, so it inherits that band's
		   foreground rather than the page's. */
		color: rgba(255, 255, 255, 0.75);
		cursor: pointer;
		border-radius: 50%;
	}
	@media (hover: hover) {
		.day-inspect-btn:hover {
			color: #fff;
			background: rgba(255, 255, 255, 0.14);
		}
	}
	.day-inspect-btn.on {
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
	}
	.grid3 {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.4rem;
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
	.warnline {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--warn-fg);
		background: var(--warn-bg);
		border-left: 2.5px solid var(--warn-bar);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		padding: 0.35rem 0.5rem;
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
