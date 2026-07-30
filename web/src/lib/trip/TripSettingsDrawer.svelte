<script lang="ts">
	// Trip settings, as a drawer over the itinerary rather than a separate page.
	//
	// Phase 5 of the WYSIWYG effort: the words of a trip are edited where they
	// render, its per-stop details live in the block inspector, and what's left —
	// the things that describe the whole trip — lives here. Edits go through the
	// same autosave as every other in-place change, so there is still exactly one
	// draft and one save path on this page.
	//
	// Structure (segments, plan variants, days) is deliberately NOT here: it is
	// a different kind of editing, and still has its own route, linked at the
	// bottom of this panel.
	import TripSettingsFields from '$lib/editor/TripSettingsFields.svelte';
	import type { Trip } from '$lib/trip-engine';
	import { t } from '$lib/i18n/store.svelte';

	let {
		trip,
		tripId,
		open = $bindable(false),
		onedit
	}: {
		trip: Trip;
		tripId: string;
		open?: boolean;
		onedit?: (structural?: boolean) => void;
	} = $props();

	let panelEl = $state<HTMLDivElement | null>(null);

	// Drive the popover from `open` so the page's existing button state (and the
	// bottom bar) stay the source of truth.
	$effect(() => {
		if (!panelEl) return;
		const isOpen = panelEl.matches(':popover-open');
		if (open && !isOpen) panelEl.showPopover();
		else if (!open && isOpen) panelEl.hidePopover();
	});

	// Light-dismiss (Escape, click outside) closes the popover directly, so mirror
	// that back into `open` or the button would fall out of sync.
	function onToggle(e: Event) {
		open = (e as ToggleEvent).newState === 'open';
	}
</script>

<div bind:this={panelEl} popover="auto" class="drawer" ontoggle={onToggle}>
	{#if open}
		<div class="dr-hd">
			<span class="dr-title">{t('editor.tripSettings')}</span>
			<button class="dr-close" onclick={() => (open = false)} aria-label={t('tripbar.close')}>✕</button>
		</div>
		<div class="dr-body">
			<TripSettingsFields {trip} {onedit} />
			<a class="dr-structure" href="/trips/{tripId}/edit">{t('editor.structureLink')}</a>
		</div>
	{/if}
</div>

<style>
	.drawer {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
		border: 1px solid var(--hairline-strong);
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--elevation-3);
		font-family: var(--font-ui);
	}
	.drawer:popover-open {
		display: flex;
		flex-direction: column;
	}
	.drawer::backdrop {
		background: color-mix(in srgb, #000 28%, transparent);
	}
	/* Desktop: a true side drawer, full height against the right edge. No JS
	   positioning needed — unlike the block inspector, this isn't anchored to
	   anything in the itinerary. */
	@media (min-width: 960px) {
		.drawer {
			inset: 0 0 0 auto;
			width: 420px;
			max-width: 100vw;
			height: 100%;
			border-radius: 0;
			border-right: none;
		}
	}
	/* Mobile: the same bottom sheet the block inspector uses. */
	@media (max-width: 959.98px) {
		.drawer {
			inset: auto 0 0 0;
			width: 100%;
			max-height: 85vh;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			border-bottom: none;
			padding-bottom: env(safe-area-inset-bottom);
		}
	}
	.dr-hd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.7rem 0.6rem 0.7rem 1rem;
		border-bottom: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	.dr-title {
		font-size: 0.9rem;
		font-weight: 600;
	}
	.dr-close {
		border: none;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.95rem;
		width: 36px;
		height: 36px;
		border-radius: 50%;
	}
	@media (hover: hover) {
		.dr-close:hover {
			background: var(--surface-sunken);
			color: var(--text);
		}
	}
	.dr-body {
		overflow-y: auto;
		padding: 0.9rem 1rem 1.2rem;
	}
	.dr-structure {
		display: block;
		margin-top: 1.1rem;
		padding-top: 0.8rem;
		border-top: 1px dashed var(--hairline);
		font-size: 0.8rem;
		color: var(--accent-strong);
	}
</style>
