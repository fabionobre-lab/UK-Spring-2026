<script lang="ts">
	// Per-plan-variant inspector, opened from the hero's variant tabs. A plan is
	// an alternate version of a segment's days — a rainy-day option beside the
	// usual one — so this panel edits the tab's label, the prefixes used on
	// per-stop diff annotations, and the variant's own structure.
	//
	// Fourth and last instance of the inspector pattern (block, day, segment,
	// plan).
	import type { Trip, Segment, Plan } from '$lib/trip-engine';
	import { slugifyId } from '$lib/editor/factories';
	import { t } from '$lib/i18n/store.svelte';

	let {
		trip,
		seg,
		plan,
		lang,
		isDefault = false,
		onedit,
		onadd,
		onduplicate,
		onremove,
		onmove,
		onsetdefault,
		canMoveUp = false,
		canMoveDown = false,
		canRemove = false
	}: {
		trip: Trip;
		seg: Segment;
		plan: Plan;
		/** Content language — labels are localized and edited in the one on show. */
		lang: string;
		isDefault?: boolean;
		onedit?: (structural?: boolean) => void;
		onadd?: () => void;
		onduplicate?: () => void;
		onremove?: () => void;
		onmove?: (dir: -1 | 1) => void;
		onsetdefault?: () => void;
		canMoveUp?: boolean;
		canMoveDown?: boolean;
		/** False on a segment's last remaining plan — the schema requires one. */
		canRemove?: boolean;
	} = $props();

	let panelEl = $state<HTMLDivElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let open = $state(false);
	const panelId = `plan-inspect-${idCounter++}`;

	function fieldChanged() {
		onedit?.();
	}
	function setLabel(value: string) {
		if (!plan.label) plan.label = { [lang]: value };
		else plan.label[lang] = value;
		onedit?.();
	}
	function setId(raw: string) {
		const next = slugifyId(raw);
		// The segment's defaultPlan points at a plan by id, so renaming one has to
		// carry that pointer along or the default silently falls back to the first.
		if (seg.defaultPlan === plan.id) seg.defaultPlan = next;
		plan.id = next;
		onedit?.(true);
	}

	// ── Diff annotation prefixes ──
	// Each is an optional localized object; diffLabels itself is dropped once
	// they're all empty, which is what turns the per-stop annotations off.
	type DiffKey = 'added' | 'changed' | 'kept';
	const DIFF_KEYS: ReadonlyArray<[DiffKey, string]> = [
		['added', 'plan.addedPrefix'],
		['changed', 'plan.changedPrefix'],
		['kept', 'plan.keptPrefix']
	];
	function setDiffLabel(key: DiffKey, value: string) {
		const next = { ...(plan.diffLabels ?? {}) };
		next[key] = { ...(next[key] ?? {}), [lang]: value };
		plan.diffLabels = next;
		onedit?.();
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
	class="plan-inspect-btn"
	class:on={open}
	popovertarget={panelId}
	aria-label={t('plan.editDetails')}
	title={t('plan.editDetails')}
>
	<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
</button>

<div bind:this={panelEl} id={panelId} popover="auto" class="inspector" ontoggle={onToggle} oninput={fieldChanged}>
	{#if open}
		<div class="ins-hd">
			<span class="ins-title">{t('plan.editDetails')}</span>
			<button class="ins-close" popovertarget={panelId} popovertargetaction="hide" aria-label={t('tripbar.close')}>✕</button>
		</div>
		<div class="ins-body">
			<label class="f">{t('plan.label')} ({lang.toUpperCase()})
				<input type="text" value={plan.label?.[lang] ?? ''} oninput={(e) => setLabel(e.currentTarget.value)} placeholder={plan.id} />
			</label>

			{#if isDefault}
				<p class="hintline">{t('plan.isDefault')}</p>
			{:else}
				<button type="button" class="mini" onclick={() => onsetdefault?.()}>{t('plan.setDefault')}</button>
			{/if}

			<div class="f">
				<span class="lbl">{t('plan.diffAnnotations')}</span>
				{#each DIFF_KEYS as [key, labelKey] (key)}
					<label class="f sub">{t(labelKey as never)}
						<input
							type="text"
							value={plan.diffLabels?.[key]?.[lang] ?? ''}
							oninput={(e) => setDiffLabel(key, e.currentTarget.value)}
						/>
					</label>
				{/each}
			</div>

			<label class="f">{t('plan.idAria')} <span class="hintline">{t('seg.internalKey')}</span>
				<input type="text" value={plan.id} oninput={(e) => setId(e.currentTarget.value)} />
			</label>
		</div>

		<div class="ins-actions">
			<button type="button" class="act" disabled={!canMoveUp} onclick={() => onmove?.(-1)} aria-label={t('plan.moveUp')} title={t('plan.moveUp')}>↑</button>
			<button type="button" class="act" disabled={!canMoveDown} onclick={() => onmove?.(1)} aria-label={t('plan.moveDown')} title={t('plan.moveDown')}>↓</button>
			<button type="button" class="act" onclick={() => onadd?.()}>+ {t('common.add')}</button>
			<button type="button" class="act" onclick={() => onduplicate?.()}>{t('day.duplicate')}</button>
			<button
				type="button"
				class="act danger"
				disabled={!canRemove}
				onclick={() => {
					panelEl?.hidePopover();
					onremove?.();
				}}
				aria-label={t('plan.remove')}>{t('block.delete')}</button
			>
		</div>
	{/if}
</div>

<style>
	.plan-inspect-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 26px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: none;
		color: rgba(255, 255, 255, 0.65);
		cursor: pointer;
		border-radius: var(--radius-pill);
	}
	@media (hover: hover) {
		.plan-inspect-btn:hover {
			color: #fff;
			background: rgba(255, 255, 255, 0.14);
		}
	}
	.plan-inspect-btn.on {
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
			width: 320px;
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
	.f {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--text-muted);
		min-width: 0;
	}
	.f.sub {
		margin-top: 0.25rem;
	}
	.lbl {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.f :global(input) {
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
	.hintline {
		margin: 0;
		font-size: 0.7rem;
		color: var(--text-muted);
	}
	.mini {
		align-self: flex-start;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--accent-strong);
		background: none;
		border: 1px solid var(--hairline-strong);
		border-radius: var(--radius-button);
		padding: 0.2rem 0.5rem;
		cursor: pointer;
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
