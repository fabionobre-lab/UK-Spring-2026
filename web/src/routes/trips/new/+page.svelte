<script lang="ts">
	import { goto } from '$app/navigation';
	import CreationWizard from '$lib/editor/CreationWizard.svelte';
	import BottomBar from '$lib/nav/BottomBar.svelte';
	import type { Trip } from '$lib/trip-engine';
	import { blankTrip, pruneEmpty, slugifyId } from '$lib/editor/factories';
	import { validateTripDoc, type TripDoc } from '$lib/validateTrip';
	import { getNow } from '$lib/now';
	import { t } from '$lib/i18n/store.svelte';

	let { data } = $props();

	// Both paths create the trip and land the author in edit mode ON the real
	// itinerary, so the first thing they touch is the finished trip rather than a
	// form describing one.
	//
	// "Start from a blank trip" used to open the standalone form editor. With
	// every field now editable in place (Phase 10), it instead mints the smallest
	// valid trip — a placeholder title, today's date, one empty stop — and drops
	// you straight into it to rename in situ.
	let stage = $state<'wizard' | 'creating'>('wizard');
	let createError = $state<string[]>([]);

	function onBlank() {
		const trip = blankTrip(['en']);
		// A title is required to derive the id, and a day needs a valid date, so
		// the blank trip is seeded just enough to satisfy the schema.
		trip.title = { en: t('wizard.blankTitle') };
		trip.segments[0].plans[0].days[0].date = getNow().toISOString().slice(0, 10);
		void onCreate(trip);
	}

	async function onCreate(trip: Trip) {
		stage = 'creating';
		createError = [];
		const clean = pruneEmpty($state.snapshot(trip)) as TripDoc | undefined;
		if (!clean) {
			createError = [t('editor.errTripEmpty')];
			stage = 'wizard';
			return;
		}
		// The client must supply a schema-valid id or the doc is rejected before
		// it reaches the server; the server still dedupes against existing trips.
		const titleText = (clean.title?.[clean.defaultLanguage] ?? '').trim();
		if (!titleText) {
			createError = [t('editor.errGiveTitle')];
			stage = 'wizard';
			return;
		}
		clean.id = slugifyId(titleText) || 'trip';
		const check = validateTripDoc(clean);
		if (!check.valid) {
			createError = check.errors;
			stage = 'wizard';
			return;
		}
		try {
			const res = await fetch('/api/trips', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(clean)
			});
			if (!res.ok) {
				const e = (await res.json()) as { error?: string; details?: string[] };
				createError = e.details ?? [e.error ?? t('editor.errSaveFailed', { status: res.status })];
				stage = 'wizard';
				return;
			}
			const created = (await res.json()) as { id: string };
			await goto(`/trips/${created.id}?edit=1`);
		} catch {
			createError = [t('editor.errNetworkSave')];
			stage = 'wizard';
		}
	}
</script>

<svelte:head>
	<title>{t('wizard.pageTitle')}</title>
</svelte:head>

{#if stage === 'wizard'}
	{#if createError.length}
		<div class="create-error" role="alert">
			<strong>{t('editor.pleaseFix')}</strong>
			<ul>{#each createError as e (e)}<li>{e}</li>{/each}</ul>
		</div>
	{/if}
	<CreationWizard {onCreate} {onBlank} />
{:else}
	<p class="creating">{t('editor.saving')}</p>
{/if}

<BottomBar user={data.user} items={[{ id: 'trips', label: t('nav.trips'), icon: 'trips', href: '/' }]} />

<style>
	.creating {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--text-muted);
		font-family: var(--font-ui);
	}
	.create-error {
		max-width: 640px;
		margin: 1rem auto 0;
		padding: 0.6rem 0.9rem;
		border-radius: var(--radius-md);
		border-left: 2.5px solid var(--warn-bar);
		background: var(--warn-bg);
		color: var(--warn-fg);
		font-family: var(--font-ui);
		font-size: 0.82rem;
	}
	.create-error ul {
		margin: 0.3rem 0 0;
		padding-left: 1.1rem;
	}
</style>
